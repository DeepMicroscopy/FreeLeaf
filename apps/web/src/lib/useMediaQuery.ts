import { useEffect, useState } from "react";

/** The first breakpoint primitive in this app — below this width, the
 * editor workspace switches from several panes shown side by side (which
 * have no room to be useful at phone width) to one view at a time with a
 * tab bar to switch between them. 768px is the conventional
 * tablet/phone-vs-desktop cutoff and nothing elsewhere in the app
 * conflicts with a different convention, since this is the first place
 * introducing one. */
export const MOBILE_BREAKPOINT_PX = 768;

/** `window.matchMedia`-backed, not a `resize` listener — fires only when
 * the query's truth value actually flips, not on every pixel of a window
 * drag, and (unlike a bare width check) accounts for the same query a CSS
 * media query would use if one were added alongside this. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
}
