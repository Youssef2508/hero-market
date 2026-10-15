// HeroMarket brandmark – keep in sync with resources/brand/heromarket-mark.svg
export function BrandMark({ size = 36, title = 'HeroMarket', className = '' }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="14" fill="#153B32" />
      <rect x="13" y="12" width="9.5" height="40" rx="3" fill="#F4F6F3" />
      <rect x="41.5" y="12" width="9.5" height="40" rx="3" fill="#F4F6F3" />
      <rect x="22.5" y="29" width="19" height="4" fill="#F4F6F3" />
      <rect x="22.5" y="39" width="19" height="3" fill="#F4F6F3" opacity="0.55" />
      <rect x="26.5" y="19.5" width="11" height="9.5" rx="2" fill="#2FC08E" />
    </svg>
  )
}

export function Wordmark({ withTag = true, className = '' }) {
  return (
    <span className={`wordmark ${className}`} dir="ltr">
      <span className="wordmark-hero">Hero</span>
      <span className="wordmark-market">Market</span>
      {withTag && <span className="wordmark-tag">POS</span>}
    </span>
  )
}
