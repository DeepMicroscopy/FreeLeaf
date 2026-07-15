/** A small cute-baby-penguin illustration for the fix-it dialogs — pure
 * decoration. Served as a static asset via Vite's `public/` convention
 * (apps/web/public/mascot/{pose}.png), same pattern as packageDocs.ts's
 * compiled example images. Purely decorative, so `alt=""`. */
export type PenguinPose = "wrench" | "magnifier" | "pencil";

const POSE_SRC: Record<PenguinPose, string> = {
  wrench: "/mascot/wrench.png",
  magnifier: "/mascot/magnifier.png",
  pencil: "/mascot/pencil.png",
};

export function PenguinMascot({ pose = "wrench", size = 56 }: { pose?: PenguinPose; size?: number }) {
  return <img src={POSE_SRC[pose]} alt="" width={size} height={size} style={{ objectFit: "contain" }} />;
}
