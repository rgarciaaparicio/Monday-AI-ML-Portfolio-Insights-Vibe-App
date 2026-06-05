import { useState, useEffect, useCallback, useRef } from 'react';
import { AimlPortfolioBoard } from '@api/BoardSDK.js';
import { fetchDocMap } from '@generated/hooks/docMapUtils';

const board = new AimlPortfolioBoard();
const COLS = ["projectStatusSummary", "projectHealthRag", "stage", "owner", "priority", "company", "projectType", "weekSummary", "concernsissues", "highlights", "activationNote"];

export function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef(null);
  const docMapRef = useRef({});

  const enrich = (items) => items.map(item => {
    const sdk = item.projectStatusSummary;
    const sdkId = sdk?.docId || sdk?.doc_id || sdk?.id || (typeof sdk === 'string' ? sdk : null);
    const mapId = docMapRef.current[item.id];
    if (!sdkId && !mapId) {
      console.log(`[Enrich] "${item.name}": SDK raw=`, JSON.stringify(sdk), '| map=', mapId);
    }
    return { ...item, _docId: sdkId ? String(sdkId) : (mapId || null) };
  });

  useEffect(() => {
    (async () => {
      try {
        const result = await board.items().withColumns(COLS).withPagination({ limit: 25 }).execute();
        const itemIds = result.items.map(i => i.id);
        console.log('[useProjects] Fetched', result.items.length, 'items. IDs:', itemIds.slice(0, 3));
        docMapRef.current = await fetchDocMap(board, itemIds);
        console.log('[useProjects] Doc map result:', JSON.stringify(docMapRef.current));
        setProjects(enrich(result.items));
        setCursor(result.cursor);
      } catch (err) { console.error('Initial fetch failed:', err); }
      setLoading(false);
    })();
  }, []);

  const fetchMore = useCallback(async (search = '', append = false, pageCursor = null) => {
    if (append) setLoadingMore(true); else setRefetching(true);
    try {
      let q = board.items().withColumns(COLS);
      if (search) q = q.where({ name: { contains: search } });
      const pag = pageCursor ? { cursor: pageCursor } : { limit: 25 };
      const result = await q.withPagination(pag).execute();
      setProjects(prev => append ? [...prev, ...enrich(result.items)] : enrich(result.items));
      setCursor(result.cursor);
    } catch (err) { console.error('Fetch failed:', err); }
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
