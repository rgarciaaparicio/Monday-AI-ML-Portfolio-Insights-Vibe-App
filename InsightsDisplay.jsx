import { AlertTriangle, TrendingUp, Clock } from 'lucide-react';

const SENTIMENT_STYLE = {
  positive: { bg: 'var(--color-green-100)', color: 'var(--color-green-800)', label: 'Positive' },
  neutral: { bg: 'var(--color-gray-200)', color: 'var(--color-gray-700)', label: 'Neutral' },
  concerning: { bg: 'var(--color-orange-100)', color: 'var(--color-orange-800)', label: 'Concerning' },
  critical: { bg: 'var(--color-red-100)', color: 'var(--color-red-700)', label: 'Critical' },
};

export function InsightsDisplay({ insights }) {
  const sentiment = SENTIMENT_STYLE[insights.sentiment] || SENTIMENT_STYLE.neutral;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
      {/* LATEST UPDATE */}
      <div>
        <p
          className="label-small"
          style={{
            marginBottom: 'var(--spacing-xs)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: 'var(--color-gray-500)',
          }}
        >
          <Clock size={13} />
          Latest Update
        </p>
        <p className="body-medium" style={{ marginBottom: 0, lineHeight: 1.6 }}>{insights.lastUpdate}</p>
      </div>

      {/* BLOCKERS & RISKS */}
      {insights.blockers?.length > 0 && (
        <div style={{
          padding: 'var(--spacing-sm) var(--spacing-md)',
          backgroundColor: 'var(--color-red-50)',
          borderRadius: 'var(--radius-sm)',
          borderLeft: '3px solid var(--color-red-400)',
        }}>
          <p
            className="label-small"
            style={{
              color: 'var(--color-red-600)',
              marginBottom: 'var(--spacing-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangle size={14} />
            Blockers & Risks ({insights.blockers.length})
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 'var(--spacing-lg)',
              listStyleType: 'disc',
            }}
          >
            {insights.blockers.map((b, i) => (
              <li
                key={i}
                className="body-small"
                style={{ marginBottom: 'var(--spacing-xs)', color: 'var(--color-gray-700)' }}
              >
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* HIGHLIGHTS */}
      {insights.highlights?.length > 0 && (
        <div style={{
          padding: 'var(--spacing-sm) var(--spacing-md)',
          backgroundColor: 'var(--color-green-50)',
          borderRadius: 'var(--radius-sm)',
          borderLeft: '3px solid var(--color-green-400)',
        }}>
          <p
            className="label-small"
            style={{
              color: 'var(--color-cerulean-600)',
              marginBottom: 'var(--spacing-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <TrendingUp size={14} />
            Highlights ({insights.highlights.length})
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 'var(--spacing-lg)',
              listStyleType: 'disc',
            }}
          >
            {insights.highlights.map((h, i) => (
              <li
                key={i}
                className="body-small"
                style={{ marginBottom: 'var(--spacing-xs)', color: 'var(--color-gray-700)' }}
              >
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* NO BLOCKERS / NO HIGHLIGHTS message */}
      {(!insights.blockers || insights.blockers.length === 0) && (!insights.highlights || insights.highlights.length === 0) && (
        <p className="body-small" style={{ color: 'var(--color-gray-500)', fontStyle: 'italic' }}>
          No specific blockers or highlights extracted from this project's status data.
        </p>
      )}

      {/* SENTIMENT BADGE */}
      <div className="applause-flex-row" style={{ gap: 'var(--spacing-sm)' }}>
        <span className="body-small" style={{ color: 'var(--color-gray-500)' }}>
          Sentiment:
        </span>
        <span
          className="applause-badge"
          style={{
            backgroundColor: sentiment.bg,
            color: sentiment.color,
          }}
        >
          {sentiment.label}
        </span>
      </div>
    </div>
  );
}
