/**
 * docMapUtils.js
 * Ultimate Brute Force Extractor for Monday.com document blocks.
 * Bypasses undocumented structures by safely shredding the object graph
 * and extracting every single human-readable string.
 *
 * CRITICAL: The DocsSDK .get() only returns { id, markdown } per block.
 * Notice blocks, layout blocks, and widget blocks have markdown: null.
 * To get their content, we must query via raw GraphQL for the `content` field.
 */

import { AimlPortfolioBoard } from '@api/BoardSDK.js';

// Helper function to safely chunk arrays for GraphQL queries
const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

/**
 * Fetches FULL doc blocks via raw GraphQL including the `content` field.
 * This is necessary because DocsSDK.doc().get() only returns markdown (null for notice blocks).
 * The `content` field contains the raw Quill Delta JSON that our extractor can parse.
 */
export async function fetchDocBlocksRaw(docId) {
  const board = new AimlPortfolioBoard();
  try {
    // CRITICAL: Monday's docs API defaults to 25 blocks only!
    // Notice block child paragraphs are stored as separate blocks beyond index 25.
    // Must use blocks(limit:1000) to get all content including notice box paragraphs.
    const query = `query getDocBlocks($docId: ID!) {
      docs(ids: [$docId]) {
        id
        name
        blocks(limit: 1000) {
          id
          type
          content
          parent_block_id
        }
      }
    }`;
    const res = await board.executeGraphQL(query, { docId: String(docId) });
    const docs = res?.data?.docs || res?.docs || [];
    if (docs.length > 0 && docs[0].blocks) {
      const blocks = docs[0].blocks;
      console.log(`[docMapUtils] Fetched ${blocks.length} raw blocks for doc ${docId} (limit:1000)`);
      return blocks;
    }
    return [];
  } catch (e) {
    console.warn(`[docMapUtils] Raw block fetch failed for doc ${docId}:`, e.message);
    return [];
  }
}

/**
 * Safely parses the raw JSON string from a Monday column value to extract a doc ID.
 */
export function parseValue(raw) {
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

// --- NEW ADVANCED BLOCK PARSER ---

const MAX_DEPTH = 100;
const SKIP_KEYS = new Set([
  'color',
  'background',
  'style',
  'type',
  'alignment',
  'direction',
  'id',
  'parent_block_id',
  'created_at',
  'updated_at',
  'position',
  'afterBlockId',
  'parentBlockId',
  'block_id',
  'blockId',
  'userId',
  'user_id',
  'boardId',
  'board_id',
  'itemId',
  'item_id',
  'columnId',
  'column_id',
  'objectId',
  'object_id',
  'createdBy',
  'updatedBy',
  'theme',
  'indentation'
]);

// Keys in column-value widget objects that hold human-readable content
const VALUE_KEYS = new Set([
  'value', 'text', 'displayValue', 'display_value', 'label',
  'title', 'name', 'description', 'insert', 'content'
]);

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
        console.warn(`[docMapUtils] Maximum extraction depth (${MAX_DEPTH}) reached.`);
        depthWarningShown = true;
      }
      return '';
    }

    // Prevent circular references (e.g., if DocsSDK links blocks to parents)
    if (typeof node === 'object') {
      if (seen.has(node)) {
        return '';
      }
      seen.add(node);
    }

    // Numbers and booleans — convert to string so values like PO: 26789 are captured
    if (typeof node === 'number') {
      return String(node) + '\n';
    }
    if (typeof node === 'boolean') {
      return String(node) + '\n';
    }

    // Strings
    if (typeof node === 'string') {
      const trimmed = node.trim();

      if (!trimmed) {
        return '';
      }

      // Monday frequently embeds double-stringified JSON
      const firstChar = trimmed[0];
      if (firstChar === '{' || firstChar === '[') {
        try {
          const parsed = JSON.parse(trimmed);
          return extract(parsed, depth + 1);
        } catch {
          // Fall through if it's not valid JSON
        }
      }

      // Force a newline to guarantee distinct text elements aren't crushed together
      return trimmed + '\n';
    }

    // Arrays
    if (Array.isArray(node)) {
      return node
        .map(item => extract(item, depth + 1))
        .join('');
    }

    // Objects
    if (typeof node === 'object') {
      let output = '';

      // Detect column-value widget references and try to extract readable data
      if (node.type === 'column_values' || node.type === 'columnValues' || node.column_id || node.columnId) {
        // Try to extract any displayable value from the reference
        const refValue = node.value || node.text || node.displayValue || node.display_value || node.label;
        if (refValue != null) {
          output += extract(refValue, depth + 1);
          return output;
        }
      }

      // Handle Quill Delta object inserts (mentions, board refs, column value tags)
      if (node.insert && typeof node.insert === 'object') {
        // Object inserts often contain mentions, column refs, etc.
        const ins = node.insert;
        const readable = ins.value || ins.text || ins.displayValue || ins.display_value
          || ins.label || ins.name || ins.title || ins.content;
        if (readable != null) {
          output += extract(readable, depth + 1);
        } else {
          // Traverse the insert object itself
          output += extract(ins, depth + 1);
        }
        return output;
      }

      // Traverse all keys comprehensively. No short-circuits.
      for (const [key, value] of Object.entries(node)) {
        if (SKIP_KEYS.has(key)) {
          continue;
        }
        output += extract(value, depth + 1);
      }

      return output;
    }

    return '';
  };

  const rawText = blocks.map(block => {
    let blockText = '';
    // If the SDK provided cleanly formatted markdown, grab it first as a fallback
    if (block.markdown && typeof block.markdown === 'string') {
      blockText += block.markdown + '\n';
    }
    // Then aggressively hunt the object tree
    blockText += extract(block);
    return blockText;
  }).join('\n');

  // Cleanup + dedupe consecutive lines
  const lines = rawText
    .split('\n')
    .map(line => line.trim().replace(/\s{2,}/g, ' '));

  const result = [];
  let previousLine = null;

  for (const line of lines) {
    if (!line) {
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      continue;
    }

    // Eradicate UUIDs from the LLM context to prevent noise
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(line)) {
      continue;
    }

    // Filter out notice block metadata that leaked through
    const lower = line.toLowerCase();
    if (['info', 'general', 'warning', 'tip', 'ltr', 'rtl', 'left', 'right', 'center',
         'notice box', 'normal text', 'large title', 'medium title', 'small title',
         'bulleted list', 'numbered list', 'check list', 'divider', 'code',
         'user', 'mention', 'true', 'false'].includes(lower)) {
      continue;
    }

    // Filter bare numeric IDs (user IDs, block position numbers)
    if (/^\d{5,12}$/.test(line)) {
      continue;
    }

    if (line !== previousLine) {
      result.push(line);
      previousLine = line;
    }
  }

  return result.join('\n').trim();
};

/**
 * Enriches extracted document text by filling in column-value widget placeholders
 * with actual board data. Monday's column-value widgets are live references that
 * store NO actual text in the document blocks — just boardId/itemId/columnId refs.
 * This function detects empty label patterns and injects real values.
 */
export const enrichExtractedText = (rawText, projectData) => {
  if (!rawText || !projectData) return rawText || '';

  // Build a map of known labels to their board values
  const labelMap = {};
  if (projectData.poId) labelMap['po'] = projectData.poId;
  if (projectData.countries?.length) {
    labelMap['countries'] = projectData.countries.map(c => c.label || c.name || c).join(', ');
    labelMap['country'] = labelMap['countries'];
  }
  if (projectData.projectDescription) {
    labelMap['description'] = projectData.projectDescription;
    labelMap['project description'] = projectData.projectDescription;
  }
  if (projectData.company?.length) {
    labelMap['company'] = projectData.company.map(c => c.label || c.name || c).join(', ');
    labelMap['client'] = labelMap['company'];
  }
  if (projectData.projectType) {
    labelMap['project type'] = typeof projectData.projectType === 'string' ? projectData.projectType : (projectData.projectType?.label || '');
    labelMap['type'] = labelMap['project type'];
  }
  if (projectData.projectCollectionName) {
    labelMap['collection'] = projectData.projectCollectionName;
    labelMap['project collection name'] = projectData.projectCollectionName;
  }

  // Team members
  const teamEntries = [];
  if (projectData.owner?.length) teamEntries.push(`Owner: ${projectData.owner.map(p => p.name).join(', ')}`);
  if (projectData.leadTe?.length) teamEntries.push(`Lead TE: ${projectData.leadTe.map(p => p.name).join(', ')}`);
  if (projectData.tsm?.length) teamEntries.push(`TSM: ${projectData.tsm.map(p => p.name).join(', ')}`);
  if (projectData.tpm?.length) teamEntries.push(`TPM: ${projectData.tpm.map(p => p.name).join(', ')}`);
  if (projectData.sdm?.length) teamEntries.push(`SDM: ${projectData.sdm.map(p => p.name).join(', ')}`);
  if (projectData.cmTeam?.length) teamEntries.push(`CM: ${projectData.cmTeam.map(p => p.name).join(', ')}`);
  if (teamEntries.length) labelMap['team'] = teamEntries.join('; ');

  // Process lines: fill in empty labels and remove pure noise
  const lines = rawText.split('\n');
  const enriched = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect pattern: "Label:" with nothing after it (value is on next line or missing)
    const labelMatch = line.match(/^([^:]+):\s*$/);
    if (labelMatch) {
      const labelKey = labelMatch[1].trim().toLowerCase();
      if (labelMap[labelKey]) {
        enriched.push(`${labelMatch[1]}: ${labelMap[labelKey]}`);
        continue;
      }
    }

    // Detect pattern: "TSM: ; TPM: ; SDM: ; CM:" (empty team line)
    if (/^(TSM|TPM|SDM|CM|Owner|Lead TE)\s*:.*;\s*(TSM|TPM|SDM|CM|Owner|Lead TE)\s*:/i.test(line)) {
      if (teamEntries.length) {
        enriched.push(teamEntries.join('; '));
        continue;
      }
    }

    enriched.push(line);
  }

  return enriched.join('\n');
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
            ['doc', 'direct_doc', 'file', 'workdoc', 'board_relation', 'link'].includes(cv.type) ||
            (cv.value && typeof cv.value === 'string' && (cv.value.includes('document_id') || cv.value.includes('doc_id=') || cv.value.includes('fileId') || cv.value.includes('/docs/')))
          );

          for (const docCol of docColumns) {
            const docId = parseValue(docCol.value) || parseValue(docCol.text);
            if (docId) { foundDocId = docId; break; }
          }

          // 2C. Assets — ONLY accept assets that are clearly monday workdocs
          // Skip generic file assets (PDFs, images, etc.) which cause "Doc not found" errors
          if (!foundDocId && item.assets && item.assets.length > 0) {
            const docAsset = item.assets.find(a =>
              a.file_extension === 'monday' ||
              (a.name && a.name.toLowerCase().includes('workdoc'))
            );
            if (docAsset) foundDocId = String(docAsset.id);
          }

          // 2D. Updates — only accept assets explicitly marked as monday workdocs
          if (!foundDocId && item.updates && item.updates.length > 0) {
            for (const upd of item.updates) {
              const updAsset = (upd.assets || []).find(a => a.file_extension === 'monday');
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
