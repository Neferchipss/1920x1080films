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
 * Reverse (exit back to studio) plays at REVERSE_SPEED_MULTIPLIER times
 * each clip's own forward speed.
 */
export const BRANCH_SPEED: Partial<Record<NodeId, number[]>> = {
  about: [1.25],
  contact: [1.25],
  services: [1.25],
  portfolio: [2, 2],
};

export const REVERSE_SPEED_MULTIPLIER = 1.75;

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
