import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Badge } from '@components/ui/badge';
import { Separator } from '@components/ui/separator';
import { AlertTriangle, Activity, Shield, TrendingUp } from 'lucide-react';

const severity = {
  high: 'bg-destructive/15 text-destructive',
  medium: 'bg-[hsl(var(--chart-2))]/15 text-[hsl(var(--chart-2))]',
  low: 'bg-muted text-muted-foreground',
};

export function PortfolioReport({ report }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-[hsl(var(--chart-4))]" /> Executive Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{report.executiveSummary}</p>
        </CardContent>
      </Card>

      {report.attentionNeeded?.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <Shield className="h-4 w-4" /> Needs Immediate Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {report.attentionNeeded.map((p, i) => (
                <Badge key={i} variant="destructive">{p}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {report.topRisks?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[hsl(var(--chart-2))]" /> Top Risks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.topRisks.map((r, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Badge variant="outline" className={`text-xs capitalize shrink-0 ${severity[r.severity] || ''}`}>
                    {r.severity}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.project}</p>
                    <p className="text-sm text-muted-foreground">{r.risk}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {report.notableUpdates?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[hsl(var(--chart-1))]" /> Notable Updates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.notableUpdates.map((u, i) => (
                <div key={i}>
                  <p className="text-sm font-medium">{u.project}</p>
                  <p className="text-sm text-muted-foreground">{u.update}</p>
                  {i < report.notableUpdates.length - 1 && <Separator className="mt-3" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/40 border-dashed">
        <CardContent className="pt-5">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Overall Assessment</p>
          <p className="text-sm leading-relaxed">{report.overallAssessment}</p>
        </CardContent>
      </Card>
    </div>
  );
}
