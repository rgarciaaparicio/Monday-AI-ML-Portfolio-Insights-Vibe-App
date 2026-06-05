/**
 * docMapUtils.js
 * Deep extraction utilities for Monday.com document payloads.
 * Engineered to handle nested stringified JSONs inside Notice and Layout blocks.
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

// --- DEEP RECURSIVE UN-WRAPPER ---

/**
 * The deep recursive un-wrapper.
 * Safely navigates Monday's structural nodes and stringified JSON payloads.
 */
const unwrapMondayNode = (node) => {
  let extracted = "";

  if (node == null) return "";

  // 1. Unpack Stringified JSON (Monday wraps content heavily)
  if (typeof node === 'string') {
    try {
      const parsed = JSON.parse(node);
      return unwrapMondayNode(parsed);
    } catch (e) {
      // If parsing fails, it's a structural string (like a hex code or alignment value).
      // We discard it to prevent noise, relying on 'insert' keys below for actual text.
      return "";
    }
  }

  // 2. Traverse Arrays natively
  if (Array.isArray(node)) {
    return node.map(unwrapMondayNode).join("");
  }

  // 3. Traverse Objects to find 'insert' or deeply nested stringified structures
  if (typeof node === 'object') {
    // Core Quill Delta text property
    if (node.hasOwnProperty('insert') && typeof node.insert === 'string') {
      extracted += node.insert;
    }

    // Search deeper for nested content (e.g., child paragraphs inside a Notice block)
    for (const [key, value] of Object.entries(node)) {
      // Performance & Noise Filter: Skip known styling and metadata keys
      const noiseKeys = [
         'attributes', 'style', 'id', 'type', 'color', 'background', 
         'noticeType', 'alignment', 'direction', 'version', 'size', 'name'
      ];
      if (noiseKeys.includes(key)) continue;

      if (typeof value === 'object' && value !== null) {
        // Continue down the object tree
        extracted += unwrapMondayNode(value);
      } else if (typeof value === 'string') {
        try {
          // This catches the hidden stringified JSONs inside Notice block arrays!
          const parsedVal = JSON.parse(value);
          extracted += unwrapMondayNode(parsedVal);
        } catch (err) {
          // Ignore standard string metadata
        }
      }
    }
  }

  return extracted;
};

// --- PRIMARY BLOCK EXTRACTION ---

/**
 * Extracts clean text from Monday.com document blocks.
 * CRITICAL: We process ALL block types. Do not filter out 'notice' or 'layout' types,
 * because they contain critical project data nested deeply inside them.
 */
export const extractTextFromMondayBlocks = (blocks) => {
  if (!blocks || !Array.isArray(blocks)) return "";

  const extractedParagraphs = blocks.map(block => {
    // Use cleanly provided markdown if available
    if (block.markdown && block.markdown.trim() && block.markdown !== 'null') {
      return block.markdown;
    }
    // Skip purely structural blocks with no content payload
    if (!block.content) return "";
    
    return unwrapMondayNode(block.content);
  });

  // Filter empty results and join with double line breaks for clean AI consumption
  return extractedParagraphs.filter(text => text.trim().length > 0).join('\n\n');
};

/**
 * Legacy-compatible wrapper. Flattens nested block trees then extracts.
 */
export function parseMondayBlock(block) {
  if (block.markdown && block.markdown.trim() && block.markdown !== 'null') {
    return block.markdown;
  }
  if (block.content) {
    const extracted = unwrapMondayNode(block.content);
    return extracted ? extracted.trim() : '';
  }
  return '';
}

export const processDocumentBlocks = (blocks) => {
  if (!Array.isArray(blocks)) return '';

  // Flatten nested block trees first (layout/notice blocks nest text in child arrays)
  const flattenBlocks = (blockList) => {
    let flat = [];
    for (const block of blockList) {
      flat.push(block);
      if (Array.isArray(block.children)) flat.push(...flattenBlocks(block.children));
      if (Array.isArray(block.blocks)) flat.push(...flattenBlocks(block.blocks));
      if (Array.isArray(block.child_blocks)) flat.push(...flattenBlocks(block.child_blocks));
    }
    return flat;
  };

  const allBlocks = flattenBlocks(blocks);

  // Use the new deep unwrapper for extraction
  return extractTextFromMondayBlocks(allBlocks);
};

// --- DOC MAP LOGIC ---

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
