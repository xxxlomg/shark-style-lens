interface BrandMarkProps {
  className?: string
  size?: number
}

/** Inline brand mark so host-page CSP cannot block the content overlay icon. */
export function BrandMark({ className, size = 20 }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      viewBox="0 0 128 128"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="128" height="128" rx="28" fill="#162329" />
      <rect
        x="4"
        y="4"
        width="120"
        height="120"
        rx="24"
        fill="none"
        stroke="#2f464e"
        strokeWidth="4"
      />
      <circle cx="55" cy="54" r="27" fill="none" stroke="#f3f5f3" strokeWidth="9" />
      <path d="m76 75 28 28" fill="none" stroke="#1478e6" strokeLinecap="round" strokeWidth="12" />
      <circle cx="55" cy="54" r="7" fill="#b7e8d1" />
    </svg>
  )
}
