import { useState } from 'react';
import { Spinner } from '@components/ui/spinner';
import { useAI } from '@skills/ai-features.jsx';
import DocsSDK from '@skills/docs-sdk.jsx';
import { InsightsDisplay } from '@generated/components/InsightsDisplay';
import {
  processDocumentBlocks,
  enrichExtractedText,
  fetchDocBlocksRaw,
} from '@generated/hooks/docMapUtils';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

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
      description:
        'ALL blockers, risks, concerns, issues, challenges, delays, dependencies, staffing gaps, or anything that could slow down the project. Include at least 1 if any problem is mentioned.',
      minItems: 0,
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
      description:
        'ALL highlights, achievements, milestones, positive outcomes, deliverables completed, good metrics. Include at least 1 if any positive news is mentioned.',
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

export function ProjectInsightCard({ project }) {
  const [insights, setInsights] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const { callAI } = useAI();
  const docId = project._docId;
  const health = project.projectHealthRag;
  const stage = project.stage;

  const extract = async () => {
    if (!docId) return;
    setExtracting(true);
    setError(null);
    try {
      const rawBlocks = await fetchDocBlocksRaw(docId);
      let mergedBlocks = rawBlocks;
      if (rawBlocks.length === 0) {
        const sdk = new DocsSDK();
        const snap = await sdk.doc(String(docId)).get();
        mergedBlocks = snap.blocks || [];
      }
      const rawContent = processDocumentBlocks(mergedBlocks);
      const fullContent = enrichExtractedText(rawContent, project);

      let context = '';
      if (fullContent.trim()) {
        context += `DOCUMENT CONTENT:\n${fullContent.slice(0, 15000)}\n\n`;
      }
      context += buildBoardContext(project);

      if (!context.trim()) {
        setError(
          'No extractable content found. Please ensure the Week Summary, Highlights, or Concerns columns are populated.'
        );
        setExtracting(false);
        return;
      }

      const prompt = `You are a portfolio analyst reviewing project "${project.name}".
Thoroughly analyze ALL the following project data. Extract every single blocker, risk, concern, issue, AND every highlight or positive outcome you can find. Be exhaustive.

${context}`;

      const res = await callAI(prompt, { schema: SCHEMA });
      setInsights(res.data);
      setExpanded(true);
    } catch (err) {
      console.error('Extraction failed:', err);
      setError('Failed to extract insights');
    }
    setExtracting(false);
  };

  // Derive manager name from owner
  const managerName = project.owner?.length
    ? project.owner.map((p) => p.name).join(', ')
    : 'No Manager Assigned';

  return (
    <div className="applause-card" style={{ marginBottom: 'var(--spacing-md)' }}>
      {/* HEADER SECTION */}
      <div className="applause-flex-between" style={{ marginBottom: 'var(--spacing-md)' }}>
        <div>
          {/* APPLAUSE TYPOGRAPHY */}
          <h3 className="heading-4">{project.name || 'Unnamed Project'}</h3>

          <div className="applause-flex-row" style={{ marginTop: 'var(--spacing-xs)' }}>
            {/* BRANDED STATUS BADGES & SEPARATORS */}
            {health && (
              <span className={`applause-badge ${getStatusBadgeClass(health)}`}>
                {health}
              </span>
            )}
            {stage && (
              <span className={`applause-badge ${getStatusBadgeClass(stage)}`}>
                {stage}
              </span>
            )}
            {/* Visual separator for cleaner editorial layout */}
            <span style={{ color: 'var(--color-gray-300)', fontSize: '1.2rem', lineHeight: 0 }}>•</span>
            <span className="body-small" style={{ color: 'var(--color-gray-600)', fontWeight: 600 }}>
              {managerName}
            </span>
          </div>
        </div>

        {/* ACTION BUTTON */}
        <div style={{ flexShrink: 0, paddingTop: '2px' }}>
          {docId ? (
            insights ? (
              <button
                className="applause-btn-secondary"
                onClick={() => setExpanded((v) => !v)}
                style={{ padding: 'var(--spacing-xs) var(--spacing-sm)' }}
              >
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            ) : (
              <button className="applause-btn-primary" onClick={extract} disabled={extracting}>
                {extracting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                  </svg>
                )}
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

      {/* ERROR */}
      {error && (
        <p
          className="body-small"
          style={{
            color: 'var(--color-red-600)',
            backgroundColor: 'var(--color-red-100)',
            padding: 'var(--spacing-sm) var(--spacing-md)',
            borderRadius: 'var(--radius-sm)',
            marginTop: 'var(--spacing-sm)',
          }}
        >
          {error}
        </p>
      )}

      {/* INSIGHTS BODY CONTENT */}
      {expanded && insights && (
        <div
          style={{
            borderTop: '1px solid var(--color-gray-200)',
            marginTop: 'var(--spacing-md)',
            paddingTop: 'var(--spacing-md)',
          }}
        >
          <InsightsDisplay insights={insights} />
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------
   Builds supplemental context from board columns
   ----------------------------------------------------------------------- */
function buildBoardContext(project) {
  let ctx = '';
  const fields = [];
  if (project.poId) fields.push(`PO ID: ${project.poId}`);
  if (project.countries?.length)
    fields.push(`Countries: ${project.countries.map((c) => c.label || c).join(', ')}`);
  if (project.projectDescription)
    fields.push(`Project Description: ${project.projectDescription}`);
  if (project.company?.length)
    fields.push(`Company: ${project.company.map((c) => c.label || c).join(', ')}`);
  if (project.projectType) fields.push(`Project Type: ${project.projectType}`);
  if (project.projectCollectionName)
    fields.push(`Collection: ${project.projectCollectionName}`);

  const team = [];
  if (project.owner?.length) team.push(`Owner: ${project.owner.map((p) => p.name).join(', ')}`);
  if (project.leadTe?.length) team.push(`Lead TE: ${project.leadTe.map((p) => p.name).join(', ')}`);
  if (project.tsm?.length) team.push(`TSM: ${project.tsm.map((p) => p.name).join(', ')}`);
  if (project.tpm?.length) team.push(`TPM: ${project.tpm.map((p) => p.name).join(', ')}`);
  if (project.sdm?.length) team.push(`SDM: ${project.sdm.map((p) => p.name).join(', ')}`);
  if (project.cmTeam?.length) team.push(`CM: ${project.cmTeam.map((p) => p.name).join(', ')}`);
  if (team.length) fields.push(`Team: ${team.join('; ')}`);
  if (fields.length) ctx += `BOARD COLUMN DATA:\n${fields.join('\n')}\n\n`;

  if (project.weekSummary) ctx += `WEEK SUMMARY COLUMN:\n${project.weekSummary}\n\n`;
  if (project.concernsissues) ctx += `CONCERNS/ISSUES COLUMN:\n${project.concernsissues}\n\n`;
  if (project.highlights) ctx += `HIGHLIGHTS COLUMN:\n${project.highlights}\n\n`;
  if (project.activationNote) ctx += `ACTIVATION NOTE:\n${project.activationNote}\n\n`;
  return ctx;
}
