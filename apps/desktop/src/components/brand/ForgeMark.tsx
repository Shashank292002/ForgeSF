/**
 * The ForgeSF anvil, as an inline SVG.
 *
 * The same shape as the app icon, from the same coordinates — see
 * `src-tauri/icons/make-logo.cjs`, which draws the icon on this 1024 grid.
 * Keeping one set of numbers is what stops the window's mark and the taskbar's
 * icon drifting apart.
 *
 * It replaced a `⚡` emoji, which rendered as a different glyph on every
 * platform and matched nothing else in the product.
 *
 * Draws in `currentColor`, so the caller's tile supplies the background.
 */
export default function ForgeMark({
  size = 20,
  title,
}: {
  size?: number;
  /** Given only when the mark stands alone as a link or button. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="currentColor"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* Top face */}
      <rect x="240" y="300" width="640" height="136" rx="10" />
      {/* Horn, blunt so it does not read as an arrow */}
      <polygon points="330,300 110,344 110,392 330,436" />
      {/* Body: undercut, pinched at the waist, flaring to the foot */}
      <polygon points="392,436 728,436 686,580 728,700 392,700 434,580" />
      {/* Foot */}
      <rect x="300" y="690" width="520" height="122" rx="20" />
    </svg>
  );
}
