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
      <rect width="128" height="128" rx="30" fill="#b7e8d1" />
      <g transform="translate(5 -5) rotate(-8 64 64)">
        <path
          d="M22 12 29 112 52 90 69 120 89 109 72 78 104 74Z"
          fill="#142027"
          stroke="#f9fbfa"
          strokeLinejoin="round"
          strokeWidth="6"
        />
      </g>
    </svg>
  )
}
