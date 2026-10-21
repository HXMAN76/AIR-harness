import { AIR_LOGO_PATH, AIR_LOGO_VIEWBOX } from './AirLogo.tsx'
import type { IconProps } from './icons/props.ts'

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark (the AIR mark and the name in text).
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 74 : 48
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 74 24' : '26 0 48 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
        <svg x="0" y="0" width="24" height="24" viewBox={`0 0 ${AIR_LOGO_VIEWBOX.width} ${AIR_LOGO_VIEWBOX.height}`}>
          <path d={AIR_LOGO_PATH} fill="currentColor" />
        </svg>
      )}
      <text x="28" y="18" fill="currentColor" fontSize="18" fontWeight="600" letterSpacing="1">AIR</text>
    </svg>
  )
}
