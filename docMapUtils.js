/**
 * Utility to map Monday.com Item IDs to their attached Document IDs.
 * Built for Monday Vibe Apps.
 */

// Helper function to safely chunk arrays for GraphQL queries
const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

/**
 * Safely parses the raw JSON string from a Monday column value to extract a doc ID.
 */
function parseValue(raw) {
  if (!raw || raw === 'null' || raw === '{}' || raw === '') return null;
  
  const trimmed = raw.trim();
  
  // 1. Direct number check
  if (/^\d{8,15}$/.test(trimmed)) return trimmed;

  // 2. The Sledgehammer: Regex scrape the raw string for Monday Doc URLs
  if (typeof raw === 'string') {
    const urlMatch = raw.match(/\/docs\/(\d+)/) || raw.match(/doc_id=(\d+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
  }
  
  // 3. Fallback to structured JSON parsing
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

// --- NEW ADVANCED BLOCK PARSER (Recursive Text Hunter) ---

/**
 * Recursively extracts raw text from complex double-stringified JSON payloads (like Monday's Quill Deltas)
 */
function extractTextRecursively(payload) {
  if (!payload) return '';
  
  // If it's a string, attempt to parse it as JSON (Monday often double-stringifies Notice boxes)
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return extractTextRecursively(parsed);
    } catch (e) {
      // If it fails to parse, it's a normal string. 
      // Return it if it doesn't look like a raw hex color, system ID, or URL.
      if (payload.length > 2 && !/^[0-9a-fA-F-]+$/.test(payload) && !/^https?:\/\//.test(payload)) {
         return payload + '\n';
      }
      return '';
    }
  }

  let text = '';
  
  // Traverse arrays
  if (Array.isArray(payload)) {
    for (const item of payload) {
      text += extractTextRecursively(item);
    }
  } 
  // Traverse objects
  else if (typeof payload === 'object') {
    // Specifically look for Quill 'insert' strings or generic 'text' properties
    if (payload.insert && typeof payload.insert === 'string') {
        text += payload.insert;
    } else if (payload.text && typeof payload.text === 'string') {
        text += payload.text;
    } else {
        // Dig deeper, ignoring styling and metadata keys to keep output clean
        for (const key in payload) {
            if (key !== 'attributes' && key !== 'id' && key !== 'type' && key !== 'style') {
               text += extractTextRecursively(payload[key]);
            }
        }
    }
  }
  
  return text;
}

export function parseMondayBlock(block) {
  // Use cleanly provided markdown if available
  if (block.markdown && block.markdown.trim() && block.markdown !== 'null') {
    return block.markdown;
  }
  // Otherwise, aggressively hunt for text inside the content payload
  if (block.content) {
    const extracted = extractTextRecursively(block.content);
    return extracted ? extracted.trim() : '';
  }
  return '';
}

export const processDocumentBlocks = (blocks) => {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map(parseMondayBlock)
    .filter(Boolean)
    .join('\n\n');
};

// --- EXISTING DOC MAP LOGIC ---

export async function fetchDocMap(boardInstance, itemIds, knownDocColumnIds = []) {
  const map = {};
  if (!itemIds || itemIds.length === 0) return map;

  const uniqueItemIds = [...new Set(itemIds.map(String))];
  const idChunks = chunkArray(uniqueItemIds, 50);

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
          const docColumns = (item.column_values || []).filter(cv => 
            knownDocColumnIds.includes(cv.id) || 
            ['doc', 'file', 'workdoc', 'board_relation', 'link'].includes(cv.type) ||
            (cv.value && typeof cv.value === 'string' && (cv.value.includes('document_id') || cv.value.includes('doc_id=') || cv.value.includes('fileId') || cv.value.includes('/docs/')))
          );

          for (const docCol of docColumns) {
            const docId = parseValue(docCol.value) || parseValue(docCol.text);
            if (docId) { foundDocId = docId; break; }
          }

          if (!foundDocId && item.assets && item.assets.length > 0) {
            const docAsset = item.assets.find(a => !a.file_extension || a.file_extension === '' || a.file_extension === 'monday' || a.name.toLowerCase().includes('doc'));
            if (docAsset) foundDocId = String(docAsset.id);
          }

          if (!foundDocId && item.updates && item.updates.length > 0) {
            for (const upd of item.updates) {
              const updAsset = (upd.assets || []).find(a => !a.file_extension || a.file_extension === '' || a.file_extension === 'monday');
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

  try {
    const res = await boardInstance.executeGraphQL(`{ docs(object_ids: [18397543010], limit: 100) { id object_id name } }`);
    const docs = res?.data?.docs || res?.docs || [];
    const itemIdSet = new Set(uniqueItemIds);
    docs.forEach(d => {
      if (d.object_id && itemIdSet.has(String(d.object_id))) { map[String(d.object_id)] = String(d.id); } 
      else if (d.name) { map['__name__' + d.name] = String(d.id); }
    });
  } catch (e) { /* silent fail */ }

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
