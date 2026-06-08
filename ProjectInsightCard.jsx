import { useState } from 'react';
import { Spinner } from '@components/ui/spinner';
import { useAI } from '@skills/ai-features.jsx';
import DocsSDK from '@skills/docs-sdk.jsx';
import { InsightsDisplay } from '@generated/components/InsightsDisplay';
import { fetchItemDetails } from '@generated/hooks/useProjects';
import {
  processDocumentBlocks,
  enrichExtractedText,
  fetchDocBlocksRaw,
  exportDocAsMarkdown,
  getUsefulTextLength,
  cleanMarkdownContent,
  buildSyntheticDoc,
  getColumnText,
} from '@generated/hooks/docMapUtils.js';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

function ProjectDetailsSection({ project }) {
  const country = getColumnText(project.countries);
  const po = getColumnText(project.poId);
  const desc = getColumnText(project.projectDescription);
  const projType = getColumnText(project.projectType);
  const company = getColumnText(project.company);
  const collection = getColumnText(project.projectCollectionName);
  const participants = project.OfParticipants;
  const artifacts = project.artifactsPerParticipant;

  const team = [];
  if (project.tsm?.length) team.push({ role: 'TSM', names: project.tsm.map(p => p.name).join(', ') });
  if (project.tpm?.length) team.push({ role: 'TPM', names: project.tpm.map(p => p.name).join(', ') });
  if (project.sdm?.length) team.push({ role: 'SDM', names: project.sdm.map(p => p.name).join(', ') });
  if (project.leadTe?.length) team.push({ role: 'Lead TE', names: project.leadTe.map(p => p.name).join(', ') });
  if (project.cmTeam?.length) team.push({ role: 'CM', names: project.cmTeam.map(p => p.name).join(', ') });

  const hasDetails = country || po || desc || projType || company || team.length > 0;
  if (!hasDetails) return null;

  return (
    <div style={{
      marginBottom: 'var(--spacing-md)',
      padding: 'var(--spacing-sm) var(--spacing-md)',
      backgroundColor: 'var(--color-gray-100)',
      borderRadius: 'var(--radius-sm)',
      borderLeft: '3px solid var(--color-cerulean-400)'
    }}>
      <p className="label-small" style={{ marginBottom: 'var(--spacing-xs)', color: 'var(--color-gray-500)' }}>
        Project Details
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--spacing-xs) var(--spacing-md)' }}>
        {country && <DetailItem label="Country" value={country} />}
        {po && <DetailItem label="PO" value={po} />}
        {projType && <DetailItem label="Type" value={projType} />}
        {company && <DetailItem label="Company" value={company} />}
        {collection && <DetailItem label="Collection" value={collection} />}
        {participants && <DetailItem label="Participants" value={String(participants)} />}
        {artifacts && <DetailItem label="Artifacts/Participant" value={String(artifacts)} />}
      </div>
      {desc && (
        <p className="body-small" style={{ marginTop: 'var(--spacing-xs)', color: 'var(--color-gray-600)', fontStyle: 'italic' }}>
          {desc.length > 200 ? desc.substring(0, 200) + '…' : desc}
        </p>
      )}
      {team.length > 0 && (
        <div style={{ marginTop: 'var(--spacing-xs)', display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-xs) var(--spacing-md)' }}>
          {team.map(t => (
            <span key={t.role} className="body-small" style={{ color: 'var(--color-gray-600)' }}>
              <strong>{t.role}:</strong> {t.names}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <span className="body-small" style={{ color: 'var(--color-gray-500)' }}>{label}: </span>
      <span className="body-small" style={{ color: 'var(--color-gray-800)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// If markdown export yields fewer than this many useful chars,
// the document likely references column values (template doc)
const THIN_CONTENT_THRESHOLD = 500;

const SCHEMA = {
  type: 'object',
  properties: {
    lastUpdate: {
      type: 'string',
      description: 'A 2-3 sentence summary of the most recent project status update',
    },
    blockers: {
      type: 'array',
      items: { type: 'string' },
      description: 'ALL blockers, risks, concerns, issues, challenges, delays, dependencies, staffing gaps.',
      minItems: 0,
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
      description: 'ALL highlights, achievements, milestones, positive outcomes, deliverables completed.',
      minItems: 0,
    },
    sentiment: {
      type: 'string',
      enum: ['positive', 'neutral', 'concerning', 'critical'],
    },
  },
  required: ['lastUpdate', 'blockers', 'highlights', 'sentiment'],
};

function getStatusBadgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('risk') || s.includes('error')) return 'applause-badge-error';
  if (s.includes('off track') || s.includes('warning')) return 'applause-badge-warning';
  if (s.includes('on track') || s.includes('success')) return 'applause-badge-success';
  if (s.includes('active')) return 'applause-badge-active';
  return 'applause-badge-neutral';
}

/**
 * Multi-source doc extraction with quality-aware fallbacks.
 * When document content is thin (template with column value references),
 * builds a synthetic document from board column data.
 * 
 * IMPORTANT: Quality is measured on the ORIGINAL export (before enrichment).
 * Enrichment adds metadata (PO, country names) but NOT status narrative.
 * A template doc filled with metadata should still be treated as "thin."
 */
async function extractDocContent(docId, projectName, enrichedProject) {
  let bestContent = '';
  let bestUseful = 0;
  let originalUseful = 0; // Track pre-enrichment quality

  // PRIMARY: export_markdown_from_doc
  try {
    const markdown = await exportDocAsMarkdown(docId);
    if (markdown && markdown.length > 0) {
      // Measure ORIGINAL quality BEFORE enrichment
      const origCleaned = cleanMarkdownContent(markdown);
      originalUseful = getUsefulTextLength(origCleaned);

      const enriched = enrichExtractedText(markdown, enrichedProject);
      const cleaned = cleanMarkdownContent(enriched);
      const useful = getUsefulTextLength(cleaned);
      console.log(`[Extract] Primary markdown: ${markdown.length} raw, original=${originalUseful} useful, enriched=${useful} useful chars for "${projectName}"`);
      if (useful > bestUseful) { bestContent = cleaned; bestUseful = useful; }
    }
  } catch (e) {
    console.warn(`[Extract] Primary markdown failed for "${projectName}":`, e.message);
  }

  // Use ORIGINAL (pre-enrichment) quality to determine if doc is a template
  // Template docs reference column values — enrichment fills metadata but not status
  const isTemplateDoc = originalUseful < THIN_CONTENT_THRESHOLD;

  if (isTemplateDoc) {
    console.log(`[Extract] Document is a TEMPLATE (original=${originalUseful} < ${THIN_CONTENT_THRESHOLD}) — references column values instead of simple text`);

    // FALLBACK 1: DocsSDK
    try {
      const sdk = new DocsSDK();
      const snap = await sdk.doc(String(docId)).get();
      if (snap.markdown && snap.markdown.trim()) {
        const origUseful = getUsefulTextLength(cleanMarkdownContent(snap.markdown.trim()));
        const enriched = enrichExtractedText(snap.markdown.trim(), enrichedProject);
        const cleaned = cleanMarkdownContent(enriched);
        const useful = getUsefulTextLength(cleaned);
        console.log(`[Extract] DocsSDK fallback: original=${origUseful}, enriched=${useful} useful chars for "${projectName}"`);
        if (origUseful > originalUseful) originalUseful = origUseful;
        if (useful > bestUseful) { bestContent = cleaned; bestUseful = useful; }
      }
    } catch (sdkErr) {
      console.warn(`[Extract] DocsSDK fallback failed:`, sdkErr.message);
    }

    // FALLBACK 2: Raw block parsing
    try {
      const rawBlocks = await fetchDocBlocksRaw(docId);
      if (rawBlocks.length > 0) {
        const rawText = processDocumentBlocks(rawBlocks);
        if (rawText) {
          const origUseful = getUsefulTextLength(rawText);
          const enriched = enrichExtractedText(rawText, enrichedProject);
          const useful = getUsefulTextLength(enriched);
          console.log(`[Extract] Raw blocks fallback: original=${origUseful}, enriched=${useful} useful chars for "${projectName}"`);
          if (origUseful > originalUseful) originalUseful = origUseful;
          if (useful > bestUseful) { bestContent = enriched; bestUseful = useful; }
        }
      }
    } catch (blockErr) {
      console.warn(`[Extract] Raw blocks fallback failed:`, blockErr.message);
    }

    // FALLBACK 3: Build synthetic document from board column data
    // Always build this for template docs — it has the resolved column values
    console.log(`[Extract] Building synthetic document from board columns for "${projectName}" (template doc with column value refs)`);
    const synthetic = buildSyntheticDoc(enrichedProject);
    const syntheticUseful = getUsefulTextLength(synthetic);
    console.log(`[Extract] Synthetic doc: ${syntheticUseful} useful chars for "${projectName}"`);
    if (syntheticUseful > bestUseful) {
      bestContent = synthetic;
      bestUseful = syntheticUseful;
    }
  }

  console.log(`[Extract] Final doc content: ${bestContent.length} chars (${bestUseful} useful) for "${projectName}" [template=${isTemplateDoc}]`);
  return { content: bestContent, usefulChars: bestUseful, isTemplate: isTemplateDoc };
}

export function ProjectInsightCard({ project }) {
  const [insights, setInsights] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const [projectDetails, setProjectDetails] = useState(null);
  const { callAI } = useAI();
  const docId = project._docId;
  const health = project.projectHealthRag;
  const stage = project.stage;

  const extract = async () => {
    if (!docId) return;
    setExtracting(true);
    setError(null);
    try {
      // 1. Fetch detail columns on-demand
      const details = await fetchItemDetails(project.id);
      const enrichedProject = { ...project, ...(details || {}) };
      setProjectDetails(enrichedProject);

      // Log available board data for diagnostics
      const availableCols = ['weekSummary', 'highlights', 'concernsissues', 'projectDescription', 'poId', 'activationNote']
        .filter(col => {
          const val = getColumnText(enrichedProject[col]);
          return val && val.length > 0;
        });
      console.log(`[Extract] Board columns with data for "${project.name}": [${availableCols.join(', ')}]`);
      // Log key project facts to verify resolution
      const poVal = getColumnText(enrichedProject.poId);
      const countryVal = getColumnText(enrichedProject.countries);
      const teamVal = enrichedProject.tsm?.length ? enrichedProject.tsm.map(p=>p.name).join(',') : 'none';
      console.log(`[Extract] Key facts for "${project.name}": PO="${poVal}", Countries="${countryVal}", TSM="${teamVal}"`);

      // 2. Extract document content with quality-aware fallbacks
      let docResult = { content: '', usefulChars: 0, isTemplate: false };
      try {
        docResult = await extractDocContent(docId, project.name, enrichedProject);
      } catch (docErr) {
        const isNotFound = docErr?.message?.toLowerCase().includes('not found');
        if (!isNotFound) console.warn(`[Extract] Doc issue for "${project.name}":`, docErr.message);
      }

      // 3. Build context — doc content + board columns
      let context = '';

      // For template docs, use the synthetic doc which has clear structure
      // For rich docs, use the original extracted document content
      if (docResult.isTemplate && docResult.content.trim()) {
        // Synthetic doc has structured format with status vs background separation
        context += `${docResult.content}\n\n`;
      } else if (docResult.content.trim()) {
        context += `DOCUMENT CONTENT:\n${docResult.content.slice(0, 15000)}\n\n`;
      }

      // Always add board context (structured with clear separation)
      const boardCtx = buildBoardContext(enrichedProject);
      context += boardCtx;

      // Log the actual narrative content for diagnostics
      const ws = getColumnText(enrichedProject.weekSummary);
      if (ws) console.log(`[Extract] weekSummary for "${project.name}" (${ws.length} chars): "${ws.substring(0, 200)}"`);
      const hi = getColumnText(enrichedProject.highlights);
      if (hi) console.log(`[Extract] highlights for "${project.name}" (${hi.length} chars): "${hi.substring(0, 200)}"`);
      const ci = getColumnText(enrichedProject.concernsissues);
      if (ci) console.log(`[Extract] concerns for "${project.name}" (${ci.length} chars): "${ci.substring(0, 200)}"`);

      if (!context.trim()) {
        setError('No extractable content found. Please ensure the Week Summary, Highlights, or Concerns columns are populated.');
        setExtracting(false);
        return;
      }

      // Template docs should ALWAYS use strict anti-hallucination prompt
      // because they reference column values instead of containing narrative text
      const useStrictPrompt = docResult.isTemplate;
      console.log(`[Extract] Total context: ${context.length} chars for "${project.name}" [template=${docResult.isTemplate}, useStrictPrompt=${useStrictPrompt}]`);

      // 4. Call AI with appropriate prompt
      const prompt = buildPrompt(project.name, context, !useStrictPrompt);
      const res = await callAI(prompt, { schema: SCHEMA });
      setInsights(res.data);
      setExpanded(true);
    } catch (err) {
      console.error('Extraction failed:', err);
      setError('Failed to extract insights');
    }
    setExtracting(false);
  };

  const managerName = project.owner?.length
    ? project.owner.map((p) => p.name).join(', ')
    : 'No Manager Assigned';

  const countryPreview = getColumnText(project.countries);
  const projectType = getColumnText(project.projectType);

  return (
    <div className="applause-card" style={{ marginBottom: 'var(--spacing-md)' }}>
      <div className="applause-flex-between" style={{ marginBottom: 'var(--spacing-md)' }}>
        <div>
          <h3 className="heading-4">{project.name || 'Unnamed Project'}</h3>
          <div className="applause-flex-row" style={{ marginTop: 'var(--spacing-xs)', flexWrap: 'wrap' }}>
            {health && <span className={`applause-badge ${getStatusBadgeClass(health)}`}>{health}</span>}
            {stage && <span className={`applause-badge ${getStatusBadgeClass(stage)}`}>{stage}</span>}
            {countryPreview && <span className="applause-badge applause-badge-neutral">{countryPreview}</span>}
            {projectType && <span className="applause-badge applause-badge-neutral">{projectType}</span>}
            <span style={{ color: 'var(--color-gray-300)', fontSize: '1.2rem', lineHeight: 0 }}>•</span>
            <span className="body-small" style={{ color: 'var(--color-gray-600)', fontWeight: 600 }}>{managerName}</span>
          </div>
        </div>
        <div style={{ flexShrink: 0, paddingTop: '2px' }}>
          {docId ? (
            insights ? (
              <button className="applause-btn-secondary" onClick={() => setExpanded(v => !v)} style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            ) : (
              <button className="applause-btn-primary" onClick={extract} disabled={extracting}>
                {extracting ? <Spinner className="h-4 w-4" /> : <ExtractIcon />}
                {extracting ? 'Extracting…' : 'Extract'}
              </button>
            )
          ) : (
            <span className="body-small" style={{ color: 'var(--color-gray-500)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <FileText size={14} /> No doc
            </span>
          )}
        </div>
      </div>
      {error && (
        <p className="body-small" style={{
          color: 'var(--color-red-600)', backgroundColor: 'var(--color-red-100)',
          padding: 'var(--spacing-sm) var(--spacing-md)', borderRadius: 'var(--radius-sm)', marginTop: 'var(--spacing-sm)',
        }}>{error}</p>
      )}
      {expanded && insights && (
        <div style={{ borderTop: '1px solid var(--color-gray-200)', marginTop: 'var(--spacing-md)', paddingTop: 'var(--spacing-md)' }}>
          {/* Project Details from board columns */}
          {projectDetails && <ProjectDetailsSection project={projectDetails} />}
          <InsightsDisplay insights={insights} />
        </div>
      )}
    </div>
  );
}

function ExtractIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
      <line x1="12" y1="22.08" x2="12" y2="12"></line>
    </svg>
  );
}

function buildPrompt(projectName, context, docIsRich) {
  if (docIsRich) {
    return `You are a portfolio analyst reviewing project "${projectName}".
Thoroughly analyze ALL the following project data. Extract every single blocker, risk, concern, issue, AND every highlight or positive outcome you can find. Be exhaustive.
Focus especially on the DOCUMENT CONTENT section which contains the latest status report.

${context}`;
  }

  // STRICT prompt for template documents (column value references)
  return `You are a portfolio analyst reviewing project "${projectName}".

INSTRUCTIONS:
1. Your "lastUpdate" summary MUST include key PROJECT FACTS (country, team, PO, project scope) AND any current status from Week Summary.
2. For "blockers" — extract ONLY items explicitly mentioned as problems, risks, delays, or pending items in the "CURRENT STATUS UPDATES" section. If that section says something is incomplete or pending, it IS a blocker.
3. For "highlights" — extract ONLY items explicitly mentioned as achievements, completions, or progress in "CURRENT STATUS UPDATES".
4. For "sentiment" — base on Health (RAG): "On Track" = positive, "At Risk" = concerning, "Off Track" = critical.

CRITICAL ANTI-HALLUCINATION RULES:
- The "BACKGROUND INFO" section contains the project scope/requirements (what WILL happen). Do NOT turn future requirements into current status. Example: if scope says "100 testers will deliver 200 utterances using devices" — do NOT report "devices are being delivered" or "testers have been recruited" unless CURRENT STATUS explicitly says so.
- If CURRENT STATUS says specific things happened (e.g., "devices purchased", "DSNs collected"), report those AS-IS from the text.
- Include the country, PO number, and team members in your lastUpdate summary — these are project facts.
- Do NOT invent dates, milestones, or events not mentioned in any section.

${context}`;
}

function buildBoardContext(project) {
  let ctx = '';

  // STATUS INDICATORS
  const health = getColumnText(project.projectHealthRag);
  const stage = getColumnText(project.stage);
  if (health || stage) {
    ctx += `STATUS INDICATORS:\n`;
    if (health) ctx += `- Health (RAG): ${health}\n`;
    if (stage) ctx += `- Stage: ${stage}\n`;
    ctx += '\n';
  }

  // PROJECT FACTS (include in summary)
  const fields = [];
  const poId = getColumnText(project.poId);
  if (poId) fields.push(`PO: ${poId}`);
  const countries = getColumnText(project.countries);
  if (countries) fields.push(`Country: ${countries}`);
  const company = getColumnText(project.company);
  if (company) fields.push(`Company: ${company}`);
  const projType = getColumnText(project.projectType);
  if (projType) fields.push(`Project Type: ${projType}`);
  const collection = getColumnText(project.projectCollectionName);
  if (collection) fields.push(`Collection: ${collection}`);
  if (project.OfParticipants) fields.push(`# of Participants: ${project.OfParticipants}`);

  const team = [];
  if (project.owner?.length) team.push(`Owner: ${project.owner.map(p => p.name).join(', ')}`);
  if (project.leadTe?.length) team.push(`Lead TE: ${project.leadTe.map(p => p.name).join(', ')}`);
  if (project.tsm?.length) team.push(`TSM: ${project.tsm.map(p => p.name).join(', ')}`);
  if (project.tpm?.length) team.push(`TPM: ${project.tpm.map(p => p.name).join(', ')}`);
  if (project.sdm?.length) team.push(`SDM: ${project.sdm.map(p => p.name).join(', ')}`);
  if (project.cmTeam?.length) team.push(`CM: ${project.cmTeam.map(p => p.name).join(', ')}`);
  if (team.length) fields.push(`Team: ${team.join('; ')}`);

  if (fields.length) ctx += `PROJECT FACTS (include in lastUpdate summary):\n${fields.join('\n')}\n\n`;

  // CURRENT STATUS (dynamic — use these for blockers/highlights)
  const weekSummary = getColumnText(project.weekSummary);
  const concerns = getColumnText(project.concernsissues);
  const highlights = getColumnText(project.highlights);
  const activation = getColumnText(project.activationNote);
  const hasStatus = weekSummary || concerns || highlights;

  ctx += `CURRENT STATUS UPDATES (extract blockers/highlights from HERE):\n`;
  if (weekSummary) ctx += `Week Summary: ${weekSummary}\n`;
  if (concerns) ctx += `Concerns/Issues: ${concerns}\n`;
  if (highlights) ctx += `Highlights: ${highlights}\n`;
  if (activation) ctx += `Activation Note: ${activation}\n`;
  if (!hasStatus) ctx += `[NO STATUS UPDATES AVAILABLE — these columns are empty]\n`;
  ctx += '\n';

  // BACKGROUND (static scope — NOT for status updates)
  const desc = getColumnText(project.projectDescription);
  if (desc) ctx += `BACKGROUND SCOPE (do NOT report as current updates — this is what the project WILL do, not what happened):\n${desc}\n\n`;

  return ctx;
}
