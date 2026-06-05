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
 * @param {string} raw - The raw JSON string from the column value
 * @returns {string|null} The parsed document ID or null
 */
function parseValue(raw) {
  if (!raw || raw === 'null' || raw === '{}' || raw === '') return null;
  
  const trimmed = raw.trim();
  
  // 1. Direct number check (e.g. if the value is just "18410030796")
  if (/^\d{8,15}$/.test(trimmed)) return trimmed;

  // 2. The Sledgehammer: Regex scrape the raw string for Monday Doc URLs
  // This bypasses complex JSON parsing if the URL is hiding in unexpected keys
  if (typeof raw === 'string') {
    const urlMatch = raw.match(/\/docs\/(\d+)/) || raw.match(/doc_id=(\d+)/);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
  }
  
  // 3. Fallback to structured JSON parsing
  try {
    const parsed = JSON.parse(raw);
    let foundId = null;

    // Check for Monday 'Files' column structure (Array of files)
    if (parsed?.files && Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        let extracted = f.document_id || f.asset_id || f.docId || f.doc_id || f.file_id || (f.is_document ? f.id : null);
        
        // Ensure the extracted ID is strictly numeric before assigning
        if (extracted && /^\d+$/.test(String(extracted))) {
            foundId = String(extracted);
        }
        
        // Fallback: pure numeric IDs resting in generic ID fields
        if (!foundId && (f.fileId || f.objectId || f.id)) {
            const idStr = String(f.fileId || f.objectId || f.id);
            if (/^\d+$/.test(idStr)) foundId = idStr;
        }

        if (foundId) break;
      }
    } 
    // Check for Connect Boards column structure
    else if (parsed?.linkedPulseIds && Array.isArray(parsed.linkedPulseIds)) {
      foundId = parsed.linkedPulseIds[0]?.linkedPulseId;
    } 
    // Flat or nested 'Doc' column structures
    else {
      foundId = parsed?.document_id || 
                parsed?.documentId || 
                parsed?.file?.document_id || 
                parsed?.file?.docId || 
                parsed?.file?.doc_id || 
                parsed?.file?.id ||
                parsed?.docId || 
                parsed?.doc_id || 
                parsed?.id || 
                parsed?.objectId;
    }

    return (foundId && /^\d+$/.test(String(foundId))) ? String(foundId) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetches and maps Item IDs to Document IDs.
 * * @param {Object} boardInstance - The Monday client or seamless API wrapper.
 * @param {Array<string|number>} itemIds - Array of item IDs to query.
 * @param {Array<string>} [knownDocColumnIds=[]] - Optional: specific column IDs to check.
 * @returns {Promise<Object>} A map of { [itemId]: docId }
 */
export async function fetchDocMap(boardInstance, itemIds, knownDocColumnIds = []) {
  const map = {};
  if (!itemIds || itemIds.length === 0) return map;

  // Deduplicate and ensure strings
  const uniqueItemIds = [...new Set(itemIds.map(String))];
  const idChunks = chunkArray(uniqueItemIds, 50);

  // STRATEGY 1: Query docs directly by the Item IDs (object_id)
  try {
    for (const chunk of idChunks) {
      const query = `
        query getDocsByObjectIds($objectIds: [ID!]) {
          docs(object_ids: $objectIds, limit: 100) {
            id
            object_id
            name
          }
        }
      `;
      const res = await boardInstance.executeGraphQL(query, { objectIds: chunk.map(String) });
      const docs = res?.data?.docs || res?.docs || [];
      
      docs.forEach(d => {
        if (d.object_id && d.id) {
          map[String(d.object_id)] = String(d.id);
          console.log(`[DocMap] Strategy 1: Matched Item "${d.object_id}" to Doc ${d.id} via object_id.`);
        }
      });
    }
  } catch (e) {
    console.error('[DocMap] Strategy 1 (object_ids query) failed:', e.message || e);
  }

  // STRATEGY 2: Query the items directly and inspect their column values, native assets, and updates
  const unmappedItemIds = uniqueItemIds.filter(id => !map[id]);

  if (unmappedItemIds.length > 0) {
    try {
      const unmappedChunks = chunkArray(unmappedItemIds, 50);

      for (const chunk of unmappedChunks) {
        const query = `
          query getDocsFromItems($ids: [ID!]) {
            items(ids: $ids) {
              id
              name
              assets {
                id
                name
                file_extension
                public_url
              }
              updates(limit: 5) {
                body
                assets {
                  id
                  name
                  file_extension
                }
              }
              column_values {
                id
                type
                value
                text
              }
            }
          }
        `;
        
        const res = await boardInstance.executeGraphQL(query, { ids: chunk });
        const items = res?.data?.items || res?.items || [];

        items.forEach(item => {
          let foundDocId = null;

          // 2A. Columns
          const docColumns = (item.column_values || []).filter(cv => 
            knownDocColumnIds.includes(cv.id) || 
            ['doc', 'file', 'workdoc', 'board_relation', 'link'].includes(cv.type) ||
            (cv.value && typeof cv.value === 'string' && (cv.value.includes('document_id') || cv.value.includes('doc_id=') || cv.value.includes('fileId') || cv.value.includes('/docs/')))
          );

          for (const docCol of docColumns) {
            const docId = parseValue(docCol.value) || parseValue(docCol.text);
            if (docId) {
              foundDocId = docId;
              console.log(`[DocMap] Strategy 2A: Matched Item "${item.name}" to Doc: ${docId} via column ${docCol.id}`);
              break; 
            }
          }

          // 2B. Assets
          if (!foundDocId && item.assets && item.assets.length > 0) {
            const docAsset = item.assets.find(a => 
              !a.file_extension || a.file_extension === '' || a.file_extension === 'monday' || a.name.toLowerCase().includes('doc')
            );
            if (docAsset) {
               foundDocId = String(docAsset.id);
               console.log(`[DocMap] Strategy 2B: Matched Item "${item.name}" to Doc via Native Asset: ${foundDocId}`);
            }
          }

          // 2C. Updates
          if (!foundDocId && item.updates && item.updates.length > 0) {
            for (const upd of item.updates) {
              const updAsset = (upd.assets || []).find(a => !a.file_extension || a.file_extension === '' || a.file_extension === 'monday');
              if (updAsset) {
                foundDocId = String(updAsset.id);
                console.log(`[DocMap] Strategy 2C: Matched Item "${item.name}" to Doc via Update Asset: ${foundDocId}`);
                break;
              }
              if (upd.body && upd.body.includes('doc_id=')) {
                const match = upd.body.match(/doc_id=(\d+)/);
                if (match) {
                  foundDocId = match[1];
                  console.log(`[DocMap] Strategy 2C: Matched Item "${item.name}" to Doc via Update Hyperlink: ${foundDocId}`);
                  break;
                }
              }
            }
          }

          if (foundDocId) {
             map[item.id] = foundDocId;
          } else if (item.name.toLowerCase().includes('dark matter')) {
             console.warn(`[DocMap DEEP DEBUG] Could not map doc for "${item.name}". Inspecting raw payload:`, item);
          }
        });
      }
    } catch (e) {
      console.error('[DocMap] Strategy 2 (Item Query) failed:', e.message || e);
    }
  }

  // STRATEGY 3: Try querying docs filtered by the hardcoded portfolio board ID
  try {
    const res = await boardInstance.executeGraphQL(`{
      docs(object_ids: [18397543010], limit: 100) {
        id
        object_id
        name
      }
    }`);
    const docs = res?.data?.docs || res?.docs || [];
    console.log(`[DocMap] Strategy 3 (board object_id): ${docs.length} docs`);
    
    const itemIdSet = new Set(uniqueItemIds);
    docs.forEach(d => {
      if (d.object_id && itemIdSet.has(String(d.object_id))) {
        map[String(d.object_id)] = String(d.id);
      } else if (d.name) {
        map['__name__' + d.name] = String(d.id);
      }
    });
  } catch (e) { 
    console.error('[DocMap] Strategy 3 (Board ID query) failed:', e.message || e); 
  }

  // STRATEGY 4: Fuzzy Name Matching (Global Workspace Docs)
  const completelyUnmapped = uniqueItemIds.filter(id => !map[id]);
  if (completelyUnmapped.length > 0) {
    try {
      const res = await boardInstance.executeGraphQL(`
        query { docs(limit: 200) { id name } }
      `);
      const globalDocs = res?.data?.docs || res?.docs || [];
      const itemsRes = await boardInstance.executeGraphQL(`
        query getNames($ids: [ID!]) { items(ids: $ids) { id name } }
      `, { ids: completelyUnmapped });
      
      const unmappedItems = itemsRes?.data?.items || itemsRes?.items || [];
      unmappedItems.forEach(item => {
        const cleanItemName = (item.name || '').replace(/\[.*?\]|\(.*?\)/g, '').trim().toLowerCase();
        const matchingDoc = globalDocs.find(d => {
          const cleanDocName = (d.name || '').trim().toLowerCase();
          return cleanDocName && cleanDocName.length > 3 && (cleanItemName.includes(cleanDocName) || cleanDocName.includes(cleanItemName));
        });

        if (matchingDoc) {
          map[item.id] = String(matchingDoc.id);
          console.log(`[DocMap] Strategy 4: Name Match linked Item "${item.name}" to Doc "${matchingDoc.name}" (${matchingDoc.id})`);
        }
      });
    } catch (e) {
      console.error('[DocMap] Strategy 4 (Global Name Match) failed:', e.message || e);
    }
  }

  console.log(`[DocMap] Final matched docs map:`, map);
  return map;
}
