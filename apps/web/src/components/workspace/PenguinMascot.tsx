/** A small cute-baby-penguin illustration for the fix-it dialogs — pure
 * decoration, hand-authored flat-vector SVG (no external asset/CDN, in
 * keeping with this app's offline-friendly, self-hosted design). Each pose
 * holds a different tool matching the fix it's helping with. */
export type PenguinPose = "wrench" | "magnifier" | "pencil";

const TOOL_PATHS: Record<PenguinPose, string> = {
  // A small wrench, held up near the flipper.
  wrench: "M30 20 l6 -6 a5 5 0 1 1 3 3 l-6 6 z M27 23 l6 6 -3 3 -6 -6 z",
  // A magnifying glass.
  magnifier: "M27 16 a6 6 0 1 1 0 12 a6 6 0 1 1 0 -12 z M31.5 24.5 l6 6",
  // A pencil.
  pencil: "M26 30 l10 -10 3 3 -10 10 -4 1 z",
};

export function PenguinMascot({ pose = "wrench", size = 56 }: { pose?: PenguinPose; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* body */}
      <ellipse cx="22" cy="28" rx="14" ry="16" fill="#2b2b2b" />
      {/* white belly */}
      <ellipse cx="22" cy="31" rx="9" ry="11" fill="#ffffff" />
      {/* left flipper */}
      <ellipse cx="10" cy="28" rx="3.5" ry="8" fill="#2b2b2b" transform="rotate(-20 10 28)" />
      {/* feet */}
      <ellipse cx="16" cy="43" rx="4" ry="2.2" fill="#f5a623" />
      <ellipse cx="28" cy="43" rx="4" ry="2.2" fill="#f5a623" />
      {/* head */}
      <circle cx="22" cy="14" r="10" fill="#2b2b2b" />
      {/* face patch */}
      <ellipse cx="22" cy="16" rx="6.5" ry="6" fill="#ffffff" />
      {/* eyes */}
      <circle cx="19.5" cy="14.5" r="1.6" fill="#1a1a1a" />
      <circle cx="24.5" cy="14.5" r="1.6" fill="#1a1a1a" />
      <circle cx="19.9" cy="14" r="0.5" fill="#ffffff" />
      <circle cx="24.9" cy="14" r="0.5" fill="#ffffff" />
      {/* beak */}
      <path d="M21 17.5 l1 2 1 -2 z" fill="#f5a623" />
      {/* right flipper, holding the tool */}
      <ellipse cx="34" cy="26" rx="3.5" ry="8" fill="#2b2b2b" transform="rotate(35 34 26)" />
      <path d={TOOL_PATHS[pose]} stroke="#f5a623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
