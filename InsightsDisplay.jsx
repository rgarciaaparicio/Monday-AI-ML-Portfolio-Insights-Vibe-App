import { Badge } from '@components/ui/badge';
import { AlertTriangle, TrendingUp } from 'lucide-react';

const sentimentStyles = {
  positive: 'bg-[hsl(var(--chart-1))]/15 text-[hsl(var(--chart-1))]',
  neutral: 'bg-muted text-muted-foreground',
  concerning: 'bg-[hsl(var(--chart-2))]/15 text-[hsl(var(--chart-2))]',
  critical: 'bg-destructive/15 text-destructive',
};

export function InsightsDisplay({ insights }) {
  return (
    <div className="space-y-3 pt-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1">
          Latest Update
        </p>
        <p className="text-sm leading-relaxed">{insights.lastUpdate}</p>
      </div>

      {insights.blockers?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-destructive mb-1 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Blockers & Risks
          </p>
          <ul className="space-y-1">
            {insights.blockers.map((b, i) => (
              <li key={i} className="text-sm pl-3 relative before:content-['·'] before:absolute before:left-0 before:text-destructive before:font-bold">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.highlights?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[hsl(var(--chart-1))] mb-1 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Highlights
          </p>
          <ul className="space-y-1">
            {insights.highlights.map((h, i) => (
              <li key={i} className="text-sm pl-3 relative before:content-['·'] before:absolute before:left-0 before:text-[hsl(var(--chart-1))] before:font-bold">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-muted-foreground">Sentiment:</span>
        <Badge
          variant="outline"
          className={`text-xs capitalize ${sentimentStyles[insights.sentiment] || ''}`}
        >
          {insights.sentiment}
        </Badge>
      </div>
    </div>
  );
}
