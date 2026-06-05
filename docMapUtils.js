/**
 * docMapUtils.js
 * Robust extractor for Monday.com document blocks.
 * Goals:
 * Extract as much human-readable content as possible
 * Handle undocumented/nested structures
 * Prevent circular references
 * Prevent stack overflows
 * Preserve useful metadata
 * Produce clean LLM-friendly output
 *
 * Board: AI/ML Portfolio (18397543010)
 * Known doc columns:
 *   - portfolio_project_doc (doc) — "Project Status Summary"
 *   - direct_doc_mm0ydfp4 (direct_doc) — "monday Doc v2"
 * Known file columns:
 *   - file_mm0fx4g0 (file) — "Client Report"
 *   - file_mm0jjsta (file) — "Intake"
 *   - file_mm0j1gf4 (file) — "Final Report"
 */

// Known doc/file column IDs on the AI/ML Portfolio board
const KNOWN_DOC_COLUMN_IDS = [
  'portfolio_project_doc',
  'direct_doc_mm0ydfp4',
  'file_mm0fx4g0',
  'file_mm0jjsta',
  'file_mm0j1gf4',
];

const DOC_COLUMN_TYPES = [
  'doc', 'direct_doc', 'file', 'workdoc', 'board_relation', 'link'
];

const BOARD_ID = '18397543010';

const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

// --- DOCUMENT VALUE PARSER ---

function parseValue(raw) {
  if (!raw || raw === 'null' || raw === '{}' || raw === '') return null;
  
  const trimmed = raw.trim();
  
  if (/^\d{8,15}$/.test(trimmed)) return trimmed;

  if (typeof raw === 'string') {
    const urlMatch = raw.match(/\/docs\/(\d+)/) || raw.match(/doc_id=(\d+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
  }
  
  try {
    const parsed = JSON.parse(raw);
    let foundId = null;

    if (parsed?.files && Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        let extracted = f.document_id || f.asset_id || f.docId || f.doc_id || f.file_id || (f.is_document ? f.id : null);
        if (extracted && /^\d+$/.test(String(extracted))) foundId = String(extracted);
        if (!foundId && (f.fileId || f.objectId || f.id)) {
            const idStr = String(f.fileId || f.objectId || f.id);
            if (/^\d+$/.test(idStr)) foundId = idStr;
        }
        if (foundId) break;
      }
    } else if (parsed?.linkedPulseIds && Array.isArray(parsed.linkedPulseIds)) {
      foundId = parsed.linkedPulseIds[0]?.linkedPulseId;
    } else {
      foundId = parsed?.document_id || parsed?.documentId || parsed?.file?.document_id || parsed?.file?.docId || parsed?.file?.doc_id || parsed?.file?.id || parsed?.docId || parsed?.doc_id || parsed?.id || parsed?.objectId;
    }

    return (foundId && /^\d+$/.test(String(foundId))) ? String(foundId) : null;
  } catch (error) {
    return null;
  }
}

// --- ROBUST BLOCK EXTRACTOR ---

const MAX_DEPTH = 50;
const SKIP_KEYS = new Set([
  'color',
  'background',
  'width',
  'height',
  'style'
]);

/**
 * Extracts clean text from Monday.com document blocks.
 * Handles circular references, stack overflow prevention, double-stringified JSON,
 * Quill Deltas, Notice blocks, Layout blocks, and all undocumented nested structures.
 */
export const processDocumentBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }

  const seen = new WeakSet();
  let depthWarningShown = false;

  const extract = (node, depth = 0) => {
    if (node == null) {
      return '';
    }

    if (depth > MAX_DEPTH) {
      if (!depthWarningShown) {
        console.warn(
          `[docMapUtils] Maximum extraction depth (${MAX_DEPTH}) reached.`
        );
        depthWarningShown = true;
      }

      return '';
    }

    // Prevent circular references
    if (typeof node === 'object') {
      if (seen.has(node)) {
        return '';
      }

      seen.add(node);
    }

    // Strings
    if (typeof node === 'string') {
      const trimmed = node.trim();

      if (!trimmed) {
        return '';
      }

      // Monday sometimes embeds JSON inside strings
      const firstChar = trimmed[0];

      if (firstChar === '{' || firstChar === '[') {
        try {
          const parsed = JSON.parse(trimmed);
          return extract(parsed, depth + 1);
        } catch {
          // Fall through and treat as plain text
        }
      }

      return trimmed + ' ';
    }

    // Arrays
    if (Array.isArray(node)) {
      return node
        .map(item => extract(item, depth + 1))
        .join('');
    }

    // Objects
    if (typeof node === 'object') {
      // Explicit Quill Delta handling
      if (
        Object.prototype.hasOwnProperty.call(node, 'insert') &&
        typeof node.insert === 'string'
      ) {
        return node.insert.endsWith('\n')
          ? node.insert
          : node.insert + '\n';
      }

      let output = '';

      for (const [key, value] of Object.entries(node)) {
        if (SKIP_KEYS.has(key)) {
          continue;
        }

        output += extract(value, depth + 1);
      }

      if (output.trim() && !output.endsWith('\n')) {
        output += '\n';
      }

      return output;
    }

    return '';
  };

  const rawText = blocks
    .map(block => extract(block))
    .join('\n');

  // Cleanup + dedupe consecutive lines
  const lines = rawText
    .split('\n')
    .map(line => line.trim().replace(/\s{2,}/g, ' '));

  const result = [];
  let previousLine = null;

  for (const line of lines) {
    if (!line) {
      if (
        result.length > 0 &&
        result[result.length - 1] !== ''
      ) {
        result.push('');
      }
      continue;
    }

    if (line !== previousLine) {
      result.push(line);
      previousLine = line;
    }
  }

  return result.join('\n').trim();
};

// Alias for backward compatibility
export const extractTextFromMondayBlocks = processDocumentBlocks;

// --- DOC MAP LOGIC ---

export async function fetchDocMap(boardInstance, itemIds, extraDocColumnIds = []) {
  const map = {};
  if (!itemIds || itemIds.length === 0) return map;

  const allDocColumnIds = [...new Set([...KNOWN_DOC_COLUMN_IDS, ...extraDocColumnIds])];
  const uniqueItemIds = [...new Set(itemIds.map(String))];
  const idChunks = chunkArray(uniqueItemIds, 50);

  // STRATEGY 1: Query docs directly by Item IDs (object_id)
  try {
    for (const chunk of idChunks) {
      const query = `
        query getDocsByObjectIds($objectIds: [ID!]) {
          docs(object_ids: $objectIds, limit: 100) { id object_id name }
        }
      `;
      const res = await boardInstance.executeGraphQL(query, { objectIds: chunk.map(String) });
      const docs = res?.data?.docs || res?.docs || [];
      docs.forEach(d => {
        if (d.object_id && d.id) {
          map[String(d.object_id)] = String(d.id);
        }
      });
    }
  } catch (e) {
    console.error('[DocMap] Strategy 1 failed:', e.message || e);
  }

  // STRATEGY 2: Query items and inspect known doc/direct_doc/file columns, assets, and updates
  const unmappedItemIds = uniqueItemIds.filter(id => !map[id]);
  if (unmappedItemIds.length > 0) {
    try {
      const unmappedChunks = chunkArray(unmappedItemIds, 50);
      for (const chunk of unmappedChunks) {
        const query = `
          query getDocsFromItems($ids: [ID!]) {
            items(ids: $ids) {
              id name assets { id name file_extension public_url }
              updates(limit: 5) { body assets { id name file_extension } }
              column_values { id type value text }
            }
          }
        `;
        const res = await boardInstance.executeGraphQL(query, { ids: chunk });
        const items = res?.data?.items || res?.items || [];

        items.forEach(item => {
          let foundDocId = null;

          // 2A. Priority: check known doc columns first
          const priorityColumns = (item.column_values || []).filter(cv =>
            allDocColumnIds.includes(cv.id)
          );
          priorityColumns.sort((a, b) => {
            const aIsPrimary = (a.id === 'portfolio_project_doc' || a.id === 'direct_doc_mm0ydfp4') ? 0 : 1;
            const bIsPrimary = (b.id === 'portfolio_project_doc' || b.id === 'direct_doc_mm0ydfp4') ? 0 : 1;
            return aIsPrimary - bIsPrimary;
          });

          for (const docCol of priorityColumns) {
            const docId = parseValue(docCol.value) || parseValue(docCol.text);
            if (docId) { foundDocId = docId; break; }
          }

          // 2B. Fallback: scan all columns by type
          if (!foundDocId) {
            const typeMatchedColumns = (item.column_values || []).filter(cv =>
              !allDocColumnIds.includes(cv.id) && (
                DOC_COLUMN_TYPES.includes(cv.type) ||
                (cv.value && typeof cv.value === 'string' && (
                  cv.value.includes('document_id') || cv.value.includes('doc_id=') ||
                  cv.value.includes('fileId') || cv.value.includes('/docs/')
                ))
              )
            );
            for (const docCol of typeMatchedColumns) {
              const docId = parseValue(docCol.value) || parseValue(docCol.text);
              if (docId) { foundDocId = docId; break; }
            }
          }

          // 2C. Assets
          if (!foundDocId && item.assets && item.assets.length > 0) {
            const docAsset = item.assets.find(a =>
              !a.file_extension || a.file_extension === '' ||
              a.file_extension === 'monday' || a.name.toLowerCase().includes('doc')
            );
            if (docAsset) foundDocId = String(docAsset.id);
          }

          // 2D. Updates
          if (!foundDocId && item.updates && item.updates.length > 0) {
            for (const upd of item.updates) {
              const updAsset = (upd.assets || []).find(a =>
                !a.file_extension || a.file_extension === '' || a.file_extension === 'monday'
              );
              if (updAsset) { foundDocId = String(updAsset.id); break; }
              if (upd.body && upd.body.includes('doc_id=')) {
                const match = upd.body.match(/doc_id=(\d+)/);
                if (match) { foundDocId = match[1]; break; }
              }
            }
          }
          if (foundDocId) map[item.id] = foundDocId;
        });
      }
    } catch (e) { console.error('[DocMap] Strategy 2 failed:', e.message || e); }
  }

  // STRATEGY 3: Query docs by AI/ML Portfolio board ID
  try {
    const res = await boardInstance.executeGraphQL(`{ docs(object_ids: [${BOARD_ID}], limit: 100) { id object_id name } }`);
    const docs = res?.data?.docs || res?.docs || [];
    const itemIdSet = new Set(uniqueItemIds);
    docs.forEach(d => {
      if (d.object_id && itemIdSet.has(String(d.object_id))) { map[String(d.object_id)] = String(d.id); }
      else if (d.name) { map['__name__' + d.name] = String(d.id); }
    });
  } catch (e) { /* silent fail */ }

  // STRATEGY 4: Fuzzy Name Matching (Global Workspace Docs)
  const completelyUnmapped = uniqueItemIds.filter(id => !map[id]);
  if (completelyUnmapped.length > 0) {
    try {
      const res = await boardInstance.executeGraphQL(`query { docs(limit: 200) { id name } }`);
      const globalDocs = res?.data?.docs || res?.docs || [];
      const itemsRes = await boardInstance.executeGraphQL(`query getNames($ids: [ID!]) { items(ids: $ids) { id name } }`, { ids: completelyUnmapped });
      const unmappedItems = itemsRes?.data?.items || itemsRes?.items || [];
      unmappedItems.forEach(item => {
        const cleanItemName = (item.name || '').replace(/\[.*?\]|\(.*?\)/g, '').trim().toLowerCase();
        const matchingDoc = globalDocs.find(d => {
          const cleanDocName = (d.name || '').trim().toLowerCase();
          return cleanDocName && cleanDocName.length > 3 && (cleanItemName.includes(cleanDocName) || cleanDocName.includes(cleanItemName));
        });
        if (matchingDoc) map[item.id] = String(matchingDoc.id);
      });
    } catch (e) { /* silent fail */ }
  }

  return map;
}
