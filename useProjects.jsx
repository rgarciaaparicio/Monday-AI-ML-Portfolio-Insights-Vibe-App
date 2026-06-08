import { useState, useEffect, useCallback, useRef } from 'react';
import { AimlPortfolioBoard } from '@api/BoardSDK.js';

const board = new AimlPortfolioBoard();

// Only columns needed for the LIST/CARD display (lightweight)
const DISPLAY_COLS = [
  "projectHealthRag",
  "stage",
  "owner",
  "priority",
  "company",
  "projectType",
  "projectCollectionName",
  "countries",
  "projectStatusSummary"
];

// Detail columns fetched on-demand for extraction/report generation
export const DETAIL_COLS = [
  "weekSummary",
  "concernsissues",
  "highlights",
  "activationNote",
  "countries",
  "poId",
  "projectDescription",
  "leadTe",
  "tsm",
  "tpm",
  "sdm",
  "cmTeam"
];

/**
 * Fetches detail columns for a single item (used during extraction)
 */
export async function fetchItemDetails(itemId) {
  try {
    const item = await board.item(String(itemId))
      .withColumns(DETAIL_COLS)
      .execute();
    return item;
  } catch (err) {
    console.error(`[fetchItemDetails] Failed for item ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Fetches detail columns for multiple items (used during portfolio report)
 */
export async function fetchBatchDetails(itemIds) {
  const results = {};
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += 10) {
    chunks.push(itemIds.slice(i, i + 10));
  }
  for (const chunk of chunks) {
    const promises = chunk.map(id => fetchItemDetails(id));
    const items = await Promise.all(promises);
    items.forEach((item, idx) => {
      if (item) results[chunk[idx]] = item;
    });
  }
  return results;
}

/**
 * Extracts the docId from the projectStatusSummary column value.
 * The doc column type returns: { docId: "12345", name: "..." } or null
 */
function extractDocId(item) {
  const docCol = item.projectStatusSummary;
  if (!docCol) return null;
  
  // SDK returns { docId, name, url } for doc columns
  if (typeof docCol === 'object' && docCol.docId) {
    return String(docCol.docId);
  }
  
  // Fallback: if it's a string, try to parse
  if (typeof docCol === 'string') {
    try {
      const parsed = JSON.parse(docCol);
      if (parsed?.docId) return String(parsed.docId);
    } catch {
      // Maybe it's just a raw doc ID number
      if (/^\d+$/.test(docCol.trim())) return docCol.trim();
    }
  }
  
  return null;
}

export function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef(null);
  const mountedRef = useRef(true);

  const enrichItems = (items) => items.map(item => {
    const docId = extractDocId(item);
    return { ...item, _docId: docId };
  });

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const doFetch = async (retries = 2) => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const result = await board.items()
            .withColumns(DISPLAY_COLS)
            .withPagination({ limit: 25 })
            .execute();

          if (cancelled) return;

          const enriched = enrichItems(result.items);
          const docsCount = enriched.filter(p => p._docId).length;
          console.log(`[useProjects] Fetched ${result.items.length} items, ${docsCount} with documents`);

          // Log doc IDs for debugging
          enriched.filter(p => p._docId).forEach(p => {
            console.log(`[useProjects] "${p.name}" → docId: ${p._docId}`);
          });

          setProjects(enriched);
          setCursor(result.cursor);
          setLoading(false);
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt < retries) {
            console.warn(`[useProjects] Fetch attempt ${attempt + 1} failed, retrying...`, err.message);
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          } else {
            console.error('[useProjects] All fetch attempts failed:', err);
            setLoading(false);
          }
        }
      }
    };

    doFetch();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const fetchMore = useCallback(async (search = '', append = false, pageCursor = null) => {
    if (append) setLoadingMore(true); else setRefetching(true);
    try {
      let q = board.items().withColumns(DISPLAY_COLS);
      if (search) q = q.where({ name: { contains: search } });
      const pag = pageCursor ? { cursor: pageCursor } : { limit: 25 };
      const result = await q.withPagination(pag).execute();

      if (!mountedRef.current) return;
      const enriched = enrichItems(result.items);
      setProjects(prev => append ? [...prev, ...enriched] : enriched);
      setCursor(result.cursor);
    } catch (err) {
      console.error('[useProjects] Fetch more failed:', err.message);
    }
    setLoadingMore(false);
    setRefetching(false);
  }, []);

  const search = useCallback((term) => {
    setSearchTerm(term);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchMore(term), 300);
  }, [fetchMore]);

  const loadMore = useCallback(() => {
    if (cursor) fetchMore(searchTerm, true, cursor);
  }, [cursor, searchTerm, fetchMore]);

  return { projects, loading, loadingMore, refetching, cursor, search, loadMore, searchTerm };
}
