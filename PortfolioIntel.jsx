import { useState } from 'react';
import { Button } from '@components/ui/button';
import { Progress } from '@components/ui/progress';
import { Spinner } from '@components/ui/spinner';
import { Skeleton } from '@components/ui/skeleton';
import { useAI } from '@skills/ai-features.jsx';
import DocsSDK from '@skills/docs-sdk.jsx';
import { PortfolioReport } from '@generated/components/PortfolioReport';
import { fetchBatchDetails } from '@generated/hooks/useProjects';
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
import { Brain } from 'lucide-react';

const THIN_CONTENT_THRESHOLD = 500;

const SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: { type: 'string', description: '3-5 sentence executive summary of portfolio' },
    topRisks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          risk: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['project', 'risk', 'severity']
      },
      description: 'ALL risks, blockers, concerns found across all projects'
    },
    notableUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { project: { type: 'string' }, update: { type: 'string' } },
        required: ['project', 'update']
      },
      description: 'Key updates and highlights from each project'
    },
    attentionNeeded: { type: 'array', items: { type: 'string' }, description: 'Projects needing attention' },
    overallAssessment: { type: 'string', description: '2-3 sentence overall health assessment' },
  },
  required: ['executiveSummary', 'topRisks', 'notableUpdates', 'attentionNeeded', 'overallAssessment'],
};

/**
 * Multi-source doc extraction with synthetic doc fallback for template documents.
 * Measures ORIGINAL quality (before enrichment) to detect template docs.
 */
async function extractProjectDoc(docId, projectName, enrichedProject) {
  let bestContent = '';
  let bestUseful = 0;
  let originalUseful = 0;

  try {
    const markdown = await exportDocAsMarkdown(docId);
    if (markdown && markdown.length > 0) {
      originalUseful = getUsefulTextLength(cleanMarkdownContent(markdown));
      const enriched = enrichExtractedText(markdown, enrichedProject);
      const cleaned = cleanMarkdownContent(enriched);
      const useful = getUsefulTextLength(cleaned);
      if (useful > bestUseful) { bestContent = cleaned; bestUseful = useful; }
    }
  } catch (e) {
    console.warn(`[PortfolioIntel] Primary markdown failed for "${projectName}":`, e.message);
  }

  const isTemplate = originalUseful < THIN_CONTENT_THRESHOLD;

  if (isTemplate) {
    // FALLBACK 1: DocsSDK
    try {
      const sdk = new DocsSDK();
      const snap = await sdk.doc(String(docId)).get();
      if (snap.markdown && snap.markdown.trim()) {
        const enriched = enrichExtractedText(snap.markdown.trim(), enrichedProject);
        const cleaned = cleanMarkdownContent(enriched);
        const useful = getUsefulTextLength(cleaned);
        if (useful > bestUseful) { bestContent = cleaned; bestUseful = useful; }
      }
    } catch (e) { /* silent */ }

    // FALLBACK 2: Raw blocks
    try {
      const rawBlocks = await fetchDocBlocksRaw(docId);
      if (rawBlocks.length > 0) {
        const rawText = processDocumentBlocks(rawBlocks);
        if (rawText) {
          const enriched = enrichExtractedText(rawText, enrichedProject);
          const useful = getUsefulTextLength(enriched);
          if (useful > bestUseful) { bestContent = enriched; bestUseful = useful; }
        }
      }
    } catch (e) { /* silent */ }

    // FALLBACK 3: Synthetic document from board columns
    console.log(`[PortfolioIntel] Building synthetic doc for "${projectName}" (template with column value refs)`);
    const synthetic = buildSyntheticDoc(enrichedProject);
    const syntheticUseful = getUsefulTextLength(synthetic);
    if (syntheticUseful > bestUseful) { bestContent = synthetic; bestUseful = syntheticUseful; }
  }

  return { content: bestContent, usefulChars: bestUseful, isTemplate };
}

export function PortfolioIntel({ projects, loading }) {
  const [report, setReport] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [error, setError] = useState(null);
  const { callAI } = useAI();

  const buildContext = (project, docContent, isTemplate) => {
    let ctx = `## ${project.name}\n`;
    ctx += `Health: ${getColumnText(project.projectHealthRag) || 'N/A'} | Stage: ${getColumnText(project.stage) || 'N/A'}\n`;

    if (isTemplate) {
      ctx += `[TEMPLATE DOC — use CURRENT STATUS + PROJECT FACTS for reporting.]\n`;
    }

    if (docContent && !isTemplate) {
      ctx += `Document:\n${docContent.slice(0, 3000)}\n`;
    }

    // PROJECT FACTS (country, PO, team — should be mentioned)
    const facts = [];
    const poId = getColumnText(project.poId);
    if (poId) facts.push(`PO: ${poId}`);
    const countries = getColumnText(project.countries);
    if (countries) facts.push(`Country: ${countries}`);
    const company = getColumnText(project.company);
    if (company) facts.push(`Company: ${company}`);
    const projType = getColumnText(project.projectType);
    if (projType) facts.push(`Type: ${projType}`);
    if (facts.length) ctx += `Facts: ${facts.join(', ')}\n`;

    // CURRENT STATUS (dynamic — source of blockers/highlights)
    ctx += `Current Status:\n`;
    const weekSummary = getColumnText(project.weekSummary);
    const concerns = getColumnText(project.concernsissues);
    const highlights = getColumnText(project.highlights);
    const activation = getColumnText(project.activationNote);
    if (weekSummary) ctx += `  Week Summary: ${weekSummary}\n`;
    if (concerns) ctx += `  Concerns/Issues: ${concerns}\n`;
    if (highlights) ctx += `  Highlights: ${highlights}\n`;
    if (activation) ctx += `  Activation Note: ${activation}\n`;
    if (!weekSummary && !concerns && !highlights) ctx += `  [No status updates available]\n`;

    // SCOPE (static — don't interpret as status)
    const desc = getColumnText(project.projectDescription);
    if (desc) ctx += `Scope (requirements, NOT current status): ${desc}\n`;

    return ctx + '\n';
  };

  const generate = async () => {
    setAnalyzing(true);
    setError(null);
    setReport(null);

    const withDocs = projects.filter(p => p._docId);
    if (!withDocs.length) {
      setError('No projects have status documents');
      setAnalyzing(false);
      return;
    }

    try {
      setProgress({ current: 0, total: withDocs.length, phase: 'Loading project details...' });
      const detailsMap = await fetchBatchDetails(withDocs.map(p => p.id));

      setProgress({ current: 0, total: withDocs.length, phase: 'Reading documents...' });
      const sections = [];

      for (let i = 0; i < withDocs.length; i++) {
        const proj = { ...withDocs[i], ...(detailsMap[withDocs[i].id] || {}) };
        let docContent = '';
        let docIsTemplate = false;

        try {
          const result = await extractProjectDoc(proj._docId, proj.name, proj);
          docContent = result.content;
          docIsTemplate = result.isTemplate;
        } catch (e) {
          if (!e?.message?.toLowerCase().includes('not found')) {
            console.warn(`[PortfolioIntel] Doc issue for "${proj.name}":`, e.message);
          }
        }

        sections.push(buildContext(proj, docContent || null, docIsTemplate));
        setProgress({ current: i + 1, total: withDocs.length, phase: 'Reading documents...' });
      }

      setProgress({ current: withDocs.length, total: withDocs.length, phase: 'Generating intelligence report...' });
      const combined = sections.join('\n---\n');
      const prompt = `You are a portfolio analyst reviewing AI/ML project status reports.

INSTRUCTIONS:
- Include project facts (country, PO, team, company) when reporting on each project.
- Extract risks, blockers, highlights from the "Current Status" data (Week Summary, Concerns/Issues, Highlights).
- The "Scope" field describes what a project WILL do (requirements). Do NOT turn scope into status. For example, scope says "testers will use devices" does NOT mean "devices are being delivered."
- For [TEMPLATE DOC] projects: use Current Status + Facts. If Current Status is empty, say so.
- Empty arrays are valid. Do not fabricate blockers or highlights.

${combined}`;

      const result = await callAI(prompt, { schema: SCHEMA });
      setReport(result.data);
    } catch (e) {
      console.error('AI analysis failed:', e);
      setError('Analysis failed. Please try again.');
    }
    setAnalyzing(false);
  };

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>;
  }

  const docsCount = projects.filter(p => p._docId).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold font-[family-name:var(--font-heading)]">Portfolio Intelligence Report</h2>
          <p className="text-sm text-muted-foreground">{docsCount} of {projects.length} projects have status documents</p>
        </div>
        <Button onClick={generate} disabled={analyzing || docsCount === 0} className="shrink-0">
          {analyzing ? <Spinner className="mr-2 h-4 w-4" /> : <Brain className="mr-2 h-4 w-4" />}
          {analyzing ? 'Analyzing...' : 'Generate Report'}
        </Button>
      </div>
      {analyzing && (
        <div className="space-y-2">
          <Progress value={(progress.current / Math.max(progress.total, 1)) * 100} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">{progress.phase} ({progress.current}/{progress.total})</p>
        </div>
      )}
      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>}
      {report && <PortfolioReport report={report} />}
    </div>
  );
}
