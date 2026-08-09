export type NodeId =
  | "landing"
  | "facade"
  | "studio"
  | "about"
  | "portfolio"
  | "contact"
  | "services";

export const PARENT: Record<NodeId, NodeId | null> = {
  landing: null,
  facade: "landing",
  studio: "facade",
  about: "studio",
  portfolio: "studio",
  contact: "studio",
  services: "studio",
};

export const BRANCHES = ["portfolio", "about", "contact", "services"] as const;
export type BranchId = (typeof BRANCHES)[number];

/** Video clip(s) that play while moving from a node's parent into that node. */
export const EDGE_VIDEO: Partial<Record<NodeId, string[]>> = {
  facade: ["/video/landing-facade.mp4"],
  studio: ["/video/facade-studio.mp4"],
  about: ["/video/studio-about.mp4"],
  contact: ["/video/studio-contact.mp4"],
  services: ["/video/studio-services.mp4"],
  portfolio: ["/video/studio-portfolio-a.mp4", "/video/studio-portfolio-b.mp4"],
};

/**
 * Pre-rendered back-to-front encodes of the branch entrance clips, played
 * (forwards) to animate a branch exit.
 *
 * The exit used to be scrubbed — a rAF loop walking `video.currentTime`
 * down to 0. That can never render on these sources: they are 2560x1440
 * H.264 at 60fps, where a single *backward* seek measures ~840ms, and
 * assigning `currentTime` again while a seek is in flight replaces the
 * pending one. Instrumenting a real exit showed 57 `seeking` events and
 * exactly **one** `seeked` — the whole transition presented a single frame,
 * which is why the exit read as "nothing happens, then a hard cut".
 *
 * HTML5 video has no negative playbackRate, so the only way to get the
 * browser's normal decode pipeline (the same thing that makes the entrance
 * smooth) to run an exit is to hand it a clip that is already reversed.
 * These are encoded at 30fps rather than 60: the exit plays at ~9x, so
 * source frames beyond 30fps could never be presented anyway, and halving
 * them keeps the decode load at the entrance's proven level while halving
 * the download.
 *
 * Indexed opposite to EDGE_VIDEO — a multi-clip branch exits through its
 * clips back-to-front.
 *
 * Regenerate with (per clip, segmented because ffmpeg's `reverse` filter
 * buffers every frame in RAM):
 *   ffmpeg -ss S -t 2 -i in.mp4 -vf "fps=30,reverse" -an \
 *     -c:v libx264 -crf 22 -preset medium -pix_fmt yuv420p -g 15 seg.mp4
 * then concat the segments back-to-front with `-c copy -movflags +faststart`.
 */
export const EDGE_VIDEO_REVERSE: Partial<Record<NodeId, string[]>> = {
  about: ["/video/studio-about-rev.mp4"],
  contact: ["/video/studio-contact-rev.mp4"],
  services: ["/video/studio-services-rev.mp4"],
  portfolio: ["/video/studio-portfolio-b-rev.mp4", "/video/studio-portfolio-a-rev.mp4"],
};

/** Native duration of each clip in seconds (2K/60fps sources), for scrub math. */
export const EDGE_DURATION: Partial<Record<NodeId, number[]>> = {
  facade: [12.0],
  studio: [15.0],
  about: [7.97],
  contact: [7.97],
  services: [7.97],
  portfolio: [4.97, 12.0],
};

/**
 * Per-clip forward playback speed for each branch's entrance (studio ->
 * leaf), indexed the same as EDGE_VIDEO. >1 plays faster than real time.
 * Tuned so about/contact/services (7.97s native) land the whole entrance
 * around 1.5-2s (7.97/4.5 ≈ 1.77s), and portfolio's two-clip combination
 * (16.97s native total) lands around 3-3.5s (16.97/5.2 ≈ 3.26s). Reverse
 * (exit back to studio) plays at REVERSE_SPEED_MULTIPLIER times each
 * clip's own forward speed — i.e. in half the time.
 */
export const BRANCH_SPEED: Partial<Record<NodeId, number[]>> = {
  about: [4.5],
  contact: [4.5],
  services: [4.5],
  portfolio: [5.2, 5.2],
};

export const REVERSE_SPEED_MULTIPLIER = 2;

export function pathBetween(from: NodeId, to: NodeId): { up: NodeId[]; down: NodeId[] } {
  if (from === to) return { up: [], down: [] };

  const ancestorsOfFrom: NodeId[] = [from];
  let cur: NodeId | null = from;
  while (cur) {
    cur = PARENT[cur];
    if (cur) ancestorsOfFrom.push(cur);
  }

  const ancestorsOfTo: NodeId[] = [to];
  cur = to;
  while (cur) {
    cur = PARENT[cur];
    if (cur) ancestorsOfTo.push(cur);
  }

  const toSet = new Set(ancestorsOfTo);
  let common: NodeId | null = null;
  for (const n of ancestorsOfFrom) {
    if (toSet.has(n)) {
      common = n;
      break;
    }
  }
  if (!common) common = "landing";

  const up: NodeId[] = [];
  cur = from;
  while (cur && cur !== common) {
    up.push(cur);
    cur = PARENT[cur];
  }

  const down: NodeId[] = [];
  cur = to;
  while (cur && cur !== common) {
    down.push(cur);
    cur = PARENT[cur];
  }
  down.reverse();

  return { up, down };
}

export const SPINE_NODES: NodeId[] = ["landing", "facade", "studio"];
export const isSpineNode = (n: NodeId) => SPINE_NODES.includes(n);
export const isBranchNode = (n: NodeId): n is BranchId =>
  (BRANCHES as readonly string[]).includes(n);

export const NAV_LABEL: Record<BranchId, string> = {
  portfolio: "Portfolio",
  about: "About",
  contact: "Contact",
  services: "Services",
};
