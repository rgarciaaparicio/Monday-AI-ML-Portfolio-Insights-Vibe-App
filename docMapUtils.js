/**
 * docMapUtils.js
 * Extracts text from Monday.com document blocks.
 * 
 * Monday docs API returns blocks where `content` can be:
 * - A JSON STRING: '{"alignment":"left","direction":"ltr","deltaFormat":[{"insert":"text"}]}'
 * - A parsed JSON OBJECT: {alignment:"left", direction:"ltr", deltaFormat:[{insert:"text"}]}
 * 
 * TEMPLATE DOCUMENTS:
 * Some documents are templates with embedded column-value widgets. These appear
 * as dynamic values in the browser (PO: 26789, Countries: Japan) but export as
 * empty labels (PO:, Countries:) because the widgets reference column values
 * rather than containing simple text. When this happens, we build a synthetic
 * document from the board column data.
 */

import { AimlPortfolioBoard } from '@api/BoardSDK.js';

/**
 * Safely extracts text from any column value format.
 * Handles: plain strings, numbers, objects with .text/.value/.label/.name,
 * arrays of strings/objects, null/undefined.
 */
export function getColumnText(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    return val.map(v => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') return v.label || v.name || v.text || '';
      return String(v || '');
    }).filter(Boolean).join(', ');
  }
  if (typeof val === 'object') {
    if (typeof val.text === 'string' && val.text) return val.text;
    if (typeof val.value === 'string' && val.value) {
      try {
        const parsed = JSON.parse(val.value);
        if (typeof parsed === 'string') return parsed;
        if (parsed?.text) return parsed.text;
      } catch { return val.value; }
    }
    if (typeof val.label === 'string') return val.label;
    if (typeof val.name === 'string') return val.name;
    return '';
  }
  return String(val);
}

/**
 * Measures "useful" text content in markdown — strips formatting, links, dividers.
 */
export function getUsefulTextLength(md) {
  if (!md) return 0;
  const stripped = md
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^\|[-\s|]*\|\s*$/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_~`>|]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length;
}

/**
 * Cleans structural markdown noise.
 */
export function cleanMarkdownContent(md) {
  if (!md) return '';
  return md
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (/^[-*_]{3,}$/.test(t)) return false;
      if (/^\|[-\s|]*\|$/.test(t)) return false;
      if (t === '') return false;
      if (/^https?:\/\/\S+$/.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Builds a synthetic document from board column data.
 * Used when the actual document is a template that references column values
 * (embedded widgets) rather than containing simple text.
 * 
 * CRITICAL: Clearly separates BACKGROUND (static scope/requirements) from
 * CURRENT STATUS (dynamic updates). This prevents the AI from treating
 * project requirements as current status updates.
 */
export function buildSyntheticDoc(project) {
  const parts = [];
  parts.push(`# Project: ${project.name || 'Unknown Project'}`);
  parts.push('');

  // Current status indicators
  const health = getColumnText(project.projectHealthRag);
  const stage = getColumnText(project.stage);
  const priority = getColumnText(project.priority);
  parts.push('## CURRENT STATUS INDICATORS');
  if (health) parts.push(`- Health (RAG): ${health}`);
  if (stage) parts.push(`- Stage: ${stage}`);
  if (priority) parts.push(`- Priority: ${priority}`);
  parts.push('');

  // ===== CURRENT STATUS SECTION (dynamic, from weekly updates) =====
  const weekSummary = getColumnText(project.weekSummary);
  const highlights = getColumnText(project.highlights);
  const concerns = getColumnText(project.concernsissues);
  const activation = getColumnText(project.activationNote);

  const hasStatusContent = weekSummary || highlights || concerns;

  if (hasStatusContent) {
    parts.push('## CURRENT STATUS UPDATES (use these for latest update, blockers, highlights)');
    if (weekSummary) { parts.push(`### Week Summary:`); parts.push(weekSummary); parts.push(''); }
    if (highlights) { parts.push(`### Highlights:`); parts.push(highlights); parts.push(''); }
    if (concerns) { parts.push(`### Concerns/Issues:`); parts.push(concerns); parts.push(''); }
    if (activation) { parts.push(`### Activation Note:`); parts.push(activation); parts.push(''); }
  } else {
    parts.push('## CURRENT STATUS UPDATES');
    parts.push('NO STATUS UPDATES AVAILABLE — Week Summary, Highlights, and Concerns columns are all empty.');
    parts.push('');
  }

  // ===== PROJECT FACTS (include in summary — these are real project attributes) =====
  parts.push('## PROJECT FACTS (mention these in your summary)');
  const poId = getColumnText(project.poId);
  if (poId) parts.push(`- PO: ${poId}`);
  const countries = getColumnText(project.countries);
  if (countries) parts.push(`- Country: ${countries}`);
  const company = getColumnText(project.company);
  if (company) parts.push(`- Company: ${company}`);
  const projType = getColumnText(project.projectType);
  if (projType) parts.push(`- Project Type: ${projType}`);
  const collection = getColumnText(project.projectCollectionName);
  if (collection) parts.push(`- Collection: ${collection}`);
  if (project.OfParticipants) parts.push(`- # of Participants: ${project.OfParticipants}`);
  if (project.artifactsPerParticipant) parts.push(`- Artifacts per Participant: ${project.artifactsPerParticipant}`);

  // Team
  const team = [];
  if (project.owner?.length) team.push(`Owner: ${project.owner.map(p => p.name).join(', ')}`);
  if (project.leadTe?.length) team.push(`Lead TE: ${project.leadTe.map(p => p.name).join(', ')}`);
  if (project.tsm?.length) team.push(`TSM: ${project.tsm.map(p => p.name).join(', ')}`);
  if (project.tpm?.length) team.push(`TPM: ${project.tpm.map(p => p.name).join(', ')}`);
  if (project.sdm?.length) team.push(`SDM: ${project.sdm.map(p => p.name).join(', ')}`);
  if (project.cmTeam?.length) team.push(`CM: ${project.cmTeam.map(p => p.name).join(', ')}`);
  if (team.length) parts.push(`- Team: ${team.join('; ')}`);
  parts.push('');

  // ===== PROJECT SCOPE (do NOT convert into status updates) =====
  const desc = getColumnText(project.projectDescription);
  if (desc) {
    parts.push('## PROJECT SCOPE (requirements — do NOT interpret as current activity)');
    parts.push(desc);
    parts.push('');
  }

  const result = parts.join('\n').trim();
  console.log(`[buildSyntheticDoc] Built ${result.length} chars for "${project.name}" (hasStatusContent=${hasStatusContent})`);
  return result;
}

/**
 * Exports document content as markdown using the export_markdown_from_doc API.
 */
export async function exportDocAsMarkdown(docId) {
  const board = new AimlPortfolioBoard();
  try {
    const query = `query exportDoc($docId: ID!) {
      export_markdown_from_doc(docId: $docId) {
        success
        markdown
        error
      }
    }`;
    const res = await board.executeGraphQL(query, { docId: String(docId) });
    const result = res?.data?.export_markdown_from_doc || res?.export_markdown_from_doc;

    if (result?.success && result?.markdown) {
      const md = result.markdown.trim();
      const useful = getUsefulTextLength(md);
      console.log(`[docMapUtils] export_markdown_from_doc returned ${md.length} raw chars, ${useful} useful chars for doc ${docId}`);
      if (md.length > 0) {
        console.log(`[docMapUtils] Markdown preview (first 300 chars): "${md.substring(0, 300)}"`);
      }
      return md;
    }

    if (result?.error) {
      console.warn(`[docMapUtils] export_markdown_from_doc error for doc ${docId}: ${result.error}`);
    }
    return '';
  } catch (e) {
    console.warn(`[docMapUtils] export_markdown_from_doc failed for doc ${docId}:`, e.message);
    return '';
  }
}

/**
 * Fetches doc blocks via raw GraphQL (fallback method).
 */
export async function fetchDocBlocksRaw(docId) {
  const board = new AimlPortfolioBoard();
  try {
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
      console.log(`[docMapUtils] Fetched ${blocks.length} raw blocks for doc ${docId}`);
      return blocks;
    }
    return [];
  } catch (e) {
    console.warn(`[docMapUtils] Raw block fetch failed for doc ${docId}:`, e.message);
    return [];
  }
}

/**
 * Extracts text from a deltaFormat array (Quill Delta ops).
 */
function extractFromDeltaFormat(deltaFormat) {
  if (!Array.isArray(deltaFormat) || deltaFormat.length === 0) return '';
  const parts = [];
  for (const op of deltaFormat) {
    if (!op || op.insert === undefined || op.insert === null) continue;
    if (typeof op.insert === 'string') {
      parts.push(op.insert);
    } else if (typeof op.insert === 'object') {
      const ins = op.insert;
      // Try standard readable properties
      const readable = ins.value || ins.text || ins.displayValue || ins.display_value
        || ins.label || ins.name || ins.title || ins.content;
      if (readable && typeof readable === 'string') {
        parts.push(readable);
      } else if (ins.mention) {
        const mName = ins.mention.name || ins.mention.value || '';
        if (mName) parts.push(mName);
      }
      // Column value references — log for diagnostics
      // These are embedded widgets that reference board columns
      // They can't be resolved here — buildSyntheticDoc handles them
    }
  }
  return parts.join('');
}

/**
 * Extracts text from a content value (either string or object).
 */
function extractBlockText(content) {
  if (!content) return '';

  let parsed = null;
  if (typeof content === 'object' && content !== null) {
    parsed = content;
  } else if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed || trimmed === 'null' || trimmed === '{}') return '';
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      if (trimmed.length > 3 && /[a-zA-Z]/.test(trimmed) && !trimmed.startsWith('<')) {
        return trimmed;
      }
      return '';
    }
  } else {
    return '';
  }

  if (!parsed || typeof parsed !== 'object') return '';

  if (parsed.deltaFormat) {
    if (Array.isArray(parsed.deltaFormat)) return extractFromDeltaFormat(parsed.deltaFormat);
    if (parsed.deltaFormat.ops && Array.isArray(parsed.deltaFormat.ops)) return extractFromDeltaFormat(parsed.deltaFormat.ops);
  }
  if (parsed.ops && Array.isArray(parsed.ops)) return extractFromDeltaFormat(parsed.ops);
  if (parsed.text && typeof parsed.text === 'string') return parsed.text;

  if (parsed.content) {
    if (typeof parsed.content === 'string') {
      try {
        const inner = JSON.parse(parsed.content);
        if (inner.deltaFormat && Array.isArray(inner.deltaFormat)) return extractFromDeltaFormat(inner.deltaFormat);
        if (inner.ops && Array.isArray(inner.ops)) return extractFromDeltaFormat(inner.ops);
      } catch { return parsed.content; }
    } else if (typeof parsed.content === 'object') {
      if (parsed.content.deltaFormat && Array.isArray(parsed.content.deltaFormat)) return extractFromDeltaFormat(parsed.content.deltaFormat);
      if (parsed.content.ops && Array.isArray(parsed.content.ops)) return extractFromDeltaFormat(parsed.content.ops);
    }
  }

  for (const [key, val] of Object.entries(parsed)) {
    if (key === 'alignment' || key === 'direction' || key === 'theme' || key === 'indentation') continue;
    if (val && typeof val === 'object') {
      if (Array.isArray(val) && val.length > 0 && val[0]?.insert !== undefined) return extractFromDeltaFormat(val);
      if (val.deltaFormat && Array.isArray(val.deltaFormat)) return extractFromDeltaFormat(val.deltaFormat);
      if (val.ops && Array.isArray(val.ops)) return extractFromDeltaFormat(val.ops);
    }
  }

  return '';
}

/**
 * Processes an array of document blocks and extracts all text content.
 */
export const processDocumentBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';

  const textParts = [];
  let extractedBlockCount = 0;

  for (const block of blocks) {
    if (!block) continue;
    let blockText = '';

    if (block.content) blockText = extractBlockText(block.content);
    if (!blockText && block.markdown && typeof block.markdown === 'string') blockText = block.markdown;

    if (blockText && blockText.trim()) {
      textParts.push(blockText.trim());
      extractedBlockCount++;
    }
  }

  const rawText = textParts.join('\n');
  const cleaned = rawText.replace(/\n{3,}/g, '\n\n').trim();

  console.log(`[processDocumentBlocks] Extracted text from ${extractedBlockCount}/${blocks.length} blocks, total chars: ${cleaned.length}`);
  if (cleaned.length === 0 && blocks.length > 0) {
    console.warn(`[processDocumentBlocks] WARNING: No text extracted — blocks likely contain column value references (embedded widgets)`);
    blocks.slice(0, 5).forEach((b, i) => {
      const contentType = typeof b.content;
      const preview = contentType === 'string'
        ? b.content.substring(0, 200)
        : JSON.stringify(b.content || null).substring(0, 200);
      console.warn(`[processDocumentBlocks] Block ${i}: type="${b.type}", contentType=${contentType}, preview: ${preview}`);
    });
  }

  return cleaned;
};

/**
 * Enriches extracted document text with board column data.
 * Handles markdown list prefixes like "- PO:", "* Countries:", "## Description:"
 */
export const enrichExtractedText = (rawText, projectData) => {
  if (!rawText || !projectData) return rawText || '';

  const labelMap = {};
  const poId = getColumnText(projectData.poId);
  if (poId) labelMap['po'] = poId;
  const participants = projectData.OfParticipants;
  if (participants) labelMap['# of participants'] = String(participants);
  const countries = getColumnText(projectData.countries);
  if (countries) { labelMap['countries'] = countries; labelMap['country'] = countries; }
  const desc = getColumnText(projectData.projectDescription);
  if (desc) { labelMap['description'] = desc; labelMap['project description'] = desc; }
  const company = getColumnText(projectData.company);
  if (company) { labelMap['company'] = company; labelMap['client'] = company; }
  const projType = getColumnText(projectData.projectType);
  if (projType) { labelMap['project type'] = projType; labelMap['type'] = projType; }
  const collection = getColumnText(projectData.projectCollectionName);
  if (collection) labelMap['collection'] = collection;

  const teamEntries = [];
  if (projectData.owner?.length) teamEntries.push(`Owner: ${projectData.owner.map(p => p.name).join(', ')}`);
  if (projectData.leadTe?.length) teamEntries.push(`Lead TE: ${projectData.leadTe.map(p => p.name).join(', ')}`);
  if (projectData.tsm?.length) teamEntries.push(`TSM: ${projectData.tsm.map(p => p.name).join(', ')}`);
  if (projectData.tpm?.length) teamEntries.push(`TPM: ${projectData.tpm.map(p => p.name).join(', ')}`);
  if (projectData.sdm?.length) teamEntries.push(`SDM: ${projectData.sdm.map(p => p.name).join(', ')}`);
  if (projectData.cmTeam?.length) teamEntries.push(`CM: ${projectData.cmTeam.map(p => p.name).join(', ')}`);
  if (teamEntries.length) labelMap['team'] = teamEntries.join('; ');

  const lines = rawText.split('\n');
  const enriched = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Match label lines with optional markdown list/heading/bold prefix:
    const labelMatch = trimmed.match(/^(?:[-*+]\s+|#{1,6}\s+)?(?:\*{1,2})?([^:*]+?)(?:\*{1,2})?\s*:\s*(?:\*{1,2})?\s*$/);
    if (labelMatch) {
      const labelKey = labelMatch[1].trim().toLowerCase();
      if (labelMap[labelKey]) {
        const prefix = line.match(/^(\s*(?:[-*+]\s+|#{1,6}\s+)?)/)?.[1] || '';
        enriched.push(`${prefix}${labelMatch[1].trim()}: ${labelMap[labelKey]}`);
        console.log(`[enrichExtractedText] Filled label "${labelKey}" with: "${labelMap[labelKey].substring(0, 50)}"`);
        continue;
      }
    }

    // Handle team member lines
    if (/^(TSM|TPM|SDM|CM|Owner|Lead TE)\s*:.*;\s*(TSM|TPM|SDM|CM|Owner|Lead TE)\s*:/i.test(trimmed)) {
      if (teamEntries.length) { enriched.push(teamEntries.join('; ')); continue; }
    }

    enriched.push(line);
  }

  return enriched.join('\n');
};
