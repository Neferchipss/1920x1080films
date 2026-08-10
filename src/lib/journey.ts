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
 * down to 0. That can never render on these sources: a single *backward*
 * seek on a 2K/60fps clip measures ~840ms, and assigning `currentTime` again
 * while a seek is in flight replaces the pending one. Instrumenting a real
 * exit showed 57 `seeking` events and exactly **one** `seeked` — the whole
 * transition presented a single frame, which is why the exit read as
 * "nothing happens, then a hard cut".
 *
 * HTML5 video has no negative playbackRate, so the only way to get the
 * browser's normal decode pipeline (the same thing that makes the entrance
 * smooth) to run an exit is to hand it a clip that is already reversed.
 * Each exit clip is cut to half its entrance's length, which is what the
 * exit's old 2x reverse-speed multiplier used to buy at playback time.
 *
 * Indexed opposite to EDGE_VIDEO — a multi-clip branch exits through its
 * clips back-to-front.
 *
 * Regenerate these (and every other transition clip) with
 * `scripts/build_transition_clips.sh`.
 */
export const EDGE_VIDEO_REVERSE: Partial<Record<NodeId, string[]>> = {
  about: ["/video/studio-about-rev.mp4"],
  contact: ["/video/studio-contact-rev.mp4"],
  services: ["/video/studio-services-rev.mp4"],
  portfolio: ["/video/studio-portfolio-b-rev.mp4", "/video/studio-portfolio-a-rev.mp4"],
};

/**
 * Native duration of each shipped clip in seconds.
 *
 * Every clip is now cut to exactly the time it should occupy on screen, so
 * these *are* the transition durations — nothing is sped up at playback.
 * They must match the targets in `scripts/build_transition_clips.sh`.
 */
export const EDGE_DURATION: Partial<Record<NodeId, number[]>> = {
  // Spine clips: their rate is derived from their own duration against the
  // scroll zone they cover, so these two are fixed by spineLayout rather
  // than chosen (zone span / CRUISE_SPEED).
  facade: [3.45],
  studio: [1.9833],
  about: [1.7667],
  contact: [1.7667],
  services: [1.7667],
  portfolio: [1.9667, 1.6],
};

/** Exit clips, indexed opposite to EDGE_DURATION — half their entrance. */
export const EDGE_DURATION_REVERSE: Partial<Record<NodeId, number[]>> = {
  about: [0.8833],
  contact: [0.8833],
  services: [0.883],
  portfolio: [0.8, 0.9833],
};

/**
 * Per-clip forward playback rate for each branch's entrance (studio -> leaf),
 * indexed the same as EDGE_VIDEO.
 *
 * These used to be 4.5x-5.2x against full-length masters, with the exit at
 * twice that again. A high playbackRate does not do what it looks like it
 * does: the media clock speeds up but the decoder cannot, so most frames are
 * never presented (measured on desktop Chrome: 200 of 474 frames dropped for
 * about's entrance at 4.5x, 108 of 235 for its exit at 9x — and mobile has a
 * far smaller decode budget than that). Every clip is pre-retimed instead, so
 * the rate is 1 and each frame in the file is actually shown.
 */
export const BRANCH_SPEED: Partial<Record<NodeId, number[]>> = {
  about: [1],
  contact: [1],
  services: [1],
  portfolio: [1, 1],
};

/** Exits are shorter than entrances by encode, not by playback rate. */
export const REVERSE_SPEED_MULTIPLIER = 1;

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
