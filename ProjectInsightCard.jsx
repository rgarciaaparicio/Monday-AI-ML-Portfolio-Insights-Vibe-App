import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Spinner } from '@components/ui/spinner';
import { useAI } from '@skills/ai-features.jsx';
import DocsSDK from '@skills/docs-sdk.jsx';
import { InsightsDisplay } from '@generated/components/InsightsDisplay';
import { extractTextFromMondayBlocks } from '@generated/hooks/docMapUtils';
import { Sparkles, FileText, ChevronDown, ChevronUp } from 'lucide-react';

const HEALTH = {
  'On track': 'bg-[hsl(var(--chart-1))]/15 text-[hsl(var(--chart-1))]',
  'At risk': 'bg-[hsl(var(--chart-2))]/15 text-[hsl(var(--chart-2))]',
  'Off track': 'bg-[hsl(var(--chart-3))]/15 text-[hsl(var(--chart-3))]',
};

const SCHEMA = {
  type: 'object',
  properties: {
    lastUpdate: { type: 'string', description: 'A 2-3 sentence summary of the most recent project status update' },
    blockers: {
      type: 'array',
      items: { type: 'string' },
      description: 'ALL blockers, risks, concerns, issues, challenges, delays, dependencies, staffing gaps, or anything that could slow down the project. Include at least 1 if any problem is mentioned.',
      minItems: 0,
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
      description: 'ALL highlights, achievements, milestones, positive outcomes, deliverables completed, good metrics. Include at least 1 if any positive news is mentioned.',
      minItems: 0,
    },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'concerning', 'critical'] },
  },
  required: ['lastUpdate', 'blockers', 'highlights', 'sentiment'],
};

export function ProjectInsightCard({ project }) {
  const [insights, setInsights] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);
  const { callAI } = useAI();
  const docId = project._docId;
  const health = project.projectHealthRag;

  const extract = async () => {
    if (!docId) return;
    setExtracting(true);
    setError(null);
    try {
      const sdk = new DocsSDK();
      const snap = await sdk.doc(String(docId)).get();

      // Anti-Pattern Warning: Do NOT filter rawDocBlocks by type before extracting.
      // E.g., `rawDocBlocks.filter(b => b.type === 'paragraph')` will break extraction.
      console.log(`[Extract] "${project.name}" total blocks: ${snap.blocks?.length}`);

      // Use the new deep unwrapper that handles Notice/Layout stringified payloads
      const fullContent = extractTextFromMondayBlocks(snap.blocks);

      console.log(`[Extract] Combined content preview:`, fullContent.slice(0, 500));

      let context = '';
      if (fullContent.trim()) {
        context += `DOCUMENT CONTENT:\n${fullContent.slice(0, 15000)}\n\n`;
      }
      if (project.weekSummary) context += `WEEK SUMMARY COLUMN:\n${project.weekSummary}\n\n`;
      if (project.concernsissues) context += `CONCERNS/ISSUES COLUMN:\n${project.concernsissues}\n\n`;
      if (project.highlights) context += `HIGHLIGHTS COLUMN:\n${project.highlights}\n\n`;
      if (project.activationNote) context += `ACTIVATION NOTE:\n${project.activationNote}\n\n`;

      if (!context.trim()) { setError('No content found to analyze'); setExtracting(false); return; }

      const prompt = `You are a portfolio analyst reviewing project "${project.name}".
Thoroughly analyze ALL the following project data. The document content may contain raw JSON blocks—please read the text inside them. Extract every single blocker, risk, concern, issue, AND every highlight or positive outcome you can find. Be exhaustive — do not skip anything.

${context}`;

      const res = await callAI(prompt, { schema: SCHEMA });
      console.log(`[Extract] AI result:`, JSON.stringify(res.data));
      setInsights(res.data);
      setExpanded(true);
    } catch (err) {
      console.error('Extraction failed:', err);
      setError('Failed to extract insights');
    }
    setExtracting(false);
  };

  return (
    <Card className="border">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex-1 min-w-0">
          <CardTitle className="text-base font-medium leading-tight">{project.name}</CardTitle>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {health && <Badge variant="outline" className={HEALTH[health] || ''}>{health}</Badge>}
            {project.stage && <Badge variant="secondary" className="text-xs">{project.stage}</Badge>}
            {project.owner?.map(p => (
              <span key={p.id} className="text-xs text-muted-foreground">{p.name}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 pt-0.5">
          {docId ? (
            insights ? (
              <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            ) : (
              <Button size="sm" onClick={extract} disabled={extracting}>
                {extracting ? <Spinner className="mr-1.5 h-3 w-3" /> : <Sparkles className="mr-1.5 h-3 w-3" />}
                {extracting ? 'Extracting...' : 'Extract'}
              </Button>
            )
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" /> No doc
            </span>
          )}
        </div>
      </CardHeader>
      {error && (
        <CardContent className="pt-0 pb-3">
          <p className="text-xs text-destructive">{error}</p>
        </CardContent>
      )}
      {expanded && insights && (
        <CardContent className="pt-0 border-t">
          <InsightsDisplay insights={insights} />
        </CardContent>
      )}
    </Card>
  );
}
