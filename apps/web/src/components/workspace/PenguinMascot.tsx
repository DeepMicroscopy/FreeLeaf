/** A small cute-baby-penguin illustration for the fix-it dialogs — pure
 * decoration. Served as a static asset via Vite's `public/` convention
 * (apps/web/public/mascot/{pose}.png), same pattern as packageDocs.ts's
 * compiled example images. Purely decorative, so `alt=""`. */
export type PenguinPose = "hammer" | "puzzle" | "feather";

const POSE_SRC: Record<PenguinPose, string> = {
  hammer: "/mascot/hammer.png",
  puzzle: "/mascot/puzzle.png",
  feather: "/mascot/feather.png",
};

export function PenguinMascot({ pose = "hammer", size = 84 }: { pose?: PenguinPose; size?: number }) {
  return <img src={POSE_SRC[pose]} alt="" width={size} height={size} style={{ objectFit: "contain" }} />;
}
