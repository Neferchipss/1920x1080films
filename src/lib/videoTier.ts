/**
 * Which encode of the transition clips this device should fetch.
 *
 * The desktop tier is 1080p60 at CRF 19 — 13-15 Mbit/s, 5.8 MB for the
 * landing -> facade clip alone. Over mobile data the element cannot keep that
 * fed, so it stalls mid-clip; and because the spine reads its progress back
 * out of `currentTime`, a stalled decoder is a stalled site. The `-m` tier is
 * the same clip at 720p60 / CRF 26 — about a fifth of the bytes, and visually
 * indistinguishable on a phone, where the video is full-bleed on a ~400pt-wide
 * viewport. Both are produced by `scripts/build_transition_clips.sh`.
 */

/**
 * Must be called from the client only — it reads the viewport and the
 * Network Information API, neither of which exists during the static export.
 * Callers therefore assign `src` in an effect rather than in JSX; see the note
 * in Spine.tsx about why the elements ship without a `src` attribute.
 */
export function isMobileTier(): boolean {
  if (typeof window === "undefined") return false;

  // Physical width, not CSS width: a 3x phone at 390pt is 1170 real pixels, so
  // 720p upscales only slightly, whereas an iPad at 1024pt/2x genuinely wants
  // the full-size encode.
  const physicalWidth = window.innerWidth * (window.devicePixelRatio || 1);
  if (physicalWidth <= 1280) return true;

  // Coarse pointer with no hover is a touch device; anything in that class is
  // likely on a metered, variable connection even when the screen is large.
  const touch =
    window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;

  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    deviceMemory?: number;
  };
  const conn = nav.connection;
  if (conn?.saveData) return true;
  if (conn?.effectiveType && conn.effectiveType !== "4g") return true;
  if ((nav.deviceMemory ?? 8) <= 4) return true;

  return touch;
}

/** `/video/foo.mp4` -> `/video/foo-m.mp4` when the mobile tier is in use. */
export function tierSrc(path: string, mobile: boolean): string {
  return mobile ? path.replace(/\.mp4$/, "-m.mp4") : path;
}
