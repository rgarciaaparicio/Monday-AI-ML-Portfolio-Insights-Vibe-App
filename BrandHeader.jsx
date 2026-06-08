/**
 * BrandHeader - Applause branded page header
 * Uses the official Applause logo SVG from brand CDN
 */
export function BrandHeader({
  title = 'Portfolio Intelligence',
  subtitle = 'AI/ML Portfolio · Extract and analyze project status documents',
}) {
  return (
    <header className="applause-header">
      {/* APPLAUSE LOGO (Top-Left Placement per Guidelines) */}
      <img
        src="https://www.applause.com/wp-content/uploads/applause-logo-1.svg"
        alt="Applause"
        className="applause-logo-img"
      />

      {/* PAGE TITLES */}
      <div>
        <h1
          className="heading-2"
          style={{ color: 'var(--color-gray-800)', marginBottom: 'var(--spacing-xs)' }}
        >
          {title}
        </h1>
        <p className="body-medium" style={{ color: 'var(--color-gray-600)', marginBottom: 0 }}>
          {subtitle}
        </p>
      </div>
    </header>
  );
}
