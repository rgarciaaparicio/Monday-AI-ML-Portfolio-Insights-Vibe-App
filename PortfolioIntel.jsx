import { useState } from 'react';
import { Button } from '@components/ui/button';
import { Progress } from '@components/ui/progress';
import { Spinner } from '@components/ui/spinner';
import { Skeleton } from '@components/ui/skeleton';
import { useAI } from '@skills/ai-features.jsx';
import DocsSDK from '@skills/docs-sdk.jsx';
import { PortfolioReport } from '@generated/components/PortfolioReport';
import { Brain } from 'lucide-react';

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

export function PortfolioIntel({ projects, loading }) {
  const [report, setReport] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState(null);
  const { callAI } = useAI();

  const buildContext = (project, docMd) => {
    let ctx = `## ${project.name} (Health: ${project.projectHealthRag || 'N/A'}, Stage: ${project.stage || 'N/A'})\n`;
    if (docMd) ctx += `Document:\n${docMd.slice(0, 3000)}\n`;
    if (project.weekSummary) ctx += `Week Summary: ${project.weekSummary}\n`;
    if (project.concernsissues) ctx += `Concerns/Issues: ${project.concernsissues}\n`;
    if (project.highlights) ctx += `Highlights: ${project.highlights}\n`;
    return ctx;
  };

  const generate = async () => {
    setAnalyzing(true);
    setError(null);
    setReport(null);
    const withDocs = projects.filter(p => p._docId);
    if (!withDocs.length) { setError('No projects have status documents'); setAnalyzing(false); return; }
    setProgress({ current: 0, total: withDocs.length });
    const sdk = new DocsSDK();
    const sections = [];
    for (let i = 0; i < withDocs.length; i++) {
      try {
        const snap = await sdk.doc(String(withDocs[i]._docId)).get();
        sections.push(buildContext(withDocs[i], snap.markdown));
      } catch (e) {
        console.error(`Doc fetch failed: ${withDocs[i].name}`, e);
        sections.push(buildContext(withDocs[i], null));
      }
      setProgress({ current: i + 1, total: withDocs.length });
    }
    try {
      const combined = sections.join('\n---\n');
      const prompt = `You are a portfolio analyst. Thoroughly analyze these project status reports from the AI/ML Portfolio.
Extract EVERY risk, blocker, concern, and issue — be exhaustive. Also capture all highlights and positive outcomes.

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
          <p className="text-xs text-muted-foreground text-center">Reading document {progress.current} of {progress.total}</p>
        </div>
      )}
      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>}
      {report && <PortfolioReport report={report} />}
    </div>
  );
}
