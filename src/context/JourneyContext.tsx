"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NodeId, PARENT, pathBetween, isBranchNode } from "@/lib/journey";
import { isMobileTier } from "@/lib/videoTier";

export type SpineController = {
  /** Animate the pinned scroll spine to rest exactly at this node. */
  goTo: (node: "landing" | "facade" | "studio") => Promise<void>;
};

export type BranchController = {
  playForward: () => Promise<void>;
  playReverse: () => Promise<void>;
  /** Start buffering this branch's clips ahead of an actual click. */
  preload: () => void;
  /** Skip the transition clip and land on/leave this branch's resting frame
   *  immediately — see jumpTo. */
  openInstant: () => void;
  closeInstant: () => void;
};

type JourneyState = {
  node: NodeId;
  isAnimating: boolean;
  navOpen: boolean;
};

type JourneyApi = JourneyState & {
  goTo: (target: NodeId) => Promise<void>;
  /** Branch-to-branch only, and only between two leaves (see the guard in
   *  the implementation) — swaps which branch is showing with no transition
   *  clip, for links that want to land the user on content immediately. */
  jumpTo: (target: NodeId) => void;
  goBack: () => Promise<void>;
  setNavOpen: (open: boolean) => void;
  registerSpine: (controller: SpineController) => void;
  registerBranch: (node: NodeId, controller: BranchController) => void;
  /** Passive sync from free scrolling — updates which spine waypoint we're
   * logically "at" without going through the goTo animation machinery, so a
   * later goTo (e.g. a hotspot click) computes its path from where the user
   * actually scrolled to, not the last node they explicitly navigated to. */
  reportSpinePosition: (node: "landing" | "facade" | "studio") => void;
};

const JourneyCtx = createContext<JourneyApi | null>(null);

export function JourneyProvider({
  children,
  initialTarget,
}: {
  children: ReactNode;
  initialTarget?: NodeId;
}) {
  const [node, setNode] = useState<NodeId>("landing");
  const [isAnimating, setIsAnimating] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const spineRef = useRef<SpineController | null>(null);
  const branchRefs = useRef<Partial<Record<NodeId, BranchController>>>({});
  const nodeRef = useRef<NodeId>("landing");
  const busyRef = useRef(false);

  const registerSpine = useCallback((controller: SpineController) => {
    spineRef.current = controller;
  }, []);

  const registerBranch = useCallback((n: NodeId, controller: BranchController) => {
    branchRefs.current[n] = controller;
  }, []);

  const reportSpinePosition = useCallback((n: "landing" | "facade" | "studio") => {
    if (busyRef.current) return;
    if (nodeRef.current === n) return;
    nodeRef.current = n;
    setNode(n);
  }, []);

  const goTo = useCallback(async (target: NodeId) => {
    if (busyRef.current) return;
    if (target === nodeRef.current) return;
    busyRef.current = true;
    setIsAnimating(true);
    setNavOpen(false);

    const { up, down } = pathBetween(nodeRef.current, target);

    const arriveAt = (n: NodeId) => {
      nodeRef.current = n;
      setNode(n);
    };

    try {
      // Branches unwind one at a time, but a run of spine nodes is handed to
      // the spine as a single destination: it travels through the checkpoints
      // in between without halting, so studio -> landing reads as one
      // continuous move rather than two transitions with a stop at facade.
      let i = 0;
      while (i < up.length && isBranchNode(up[i])) {
        await branchRefs.current[up[i]]?.playReverse();
        arriveAt(PARENT[up[i]]!);
        i++;
      }
      if (i < up.length) {
        const dest = PARENT[up[up.length - 1]] as "landing" | "facade";
        await spineRef.current?.goTo(dest);
        arriveAt(dest);
      }

      // Descending, the spine nodes always come first (branches are leaves).
      let j = 0;
      while (j < down.length && !isBranchNode(down[j])) j++;
      if (j > 0) {
        const dest = down[j - 1] as "landing" | "facade" | "studio";
        await spineRef.current?.goTo(dest);
        arriveAt(dest);
      }
      for (; j < down.length; j++) {
        await branchRefs.current[down[j]]?.playForward();
        arriveAt(down[j]);
      }
    } finally {
      setIsAnimating(false);
      busyRef.current = false;
    }
  }, []);

  const jumpTo = useCallback((target: NodeId) => {
    if (busyRef.current) return;
    const current = nodeRef.current;
    if (current === target) return;
    // Only wired for branch-to-branch — a spine node has no BranchController
    // to call openInstant/closeInstant on, and nothing currently needs an
    // instant jump to/from one.
    if (!isBranchNode(current) || !isBranchNode(target)) return;
    branchRefs.current[current]?.closeInstant();
    branchRefs.current[target]?.openInstant();
    nodeRef.current = target;
    setNode(target);
  }, []);

  const goBack = useCallback(async () => {
    const parent = PARENT[nodeRef.current];
    if (!parent) return;
    await goTo(parent);
  }, [goTo]);

  useEffect(() => {
    if (!initialTarget || initialTarget === "landing") return;
    const t = setTimeout(() => {
      goTo(initialTarget);
    }, 260);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Studio is where the user is deliberately deciding which branch to enter,
  // so use that dwell time as a head start and buffer all four entrances
  // before any of them is clicked. Since the clips were retimed this is ~9MB
  // rather than ~40MB, which is what makes speculatively fetching all four
  // reasonable at all — but it is still four files the user may never watch,
  // so an explicit data-saver preference opts out and each branch falls back
  // to fetching itself when it is actually entered.
  //
  // Mobile skips this too, byte count aside: it means 5 video elements
  // (about, portfolio x2, contact, services) all buffering — and briefly
  // decoding, since <video preload="auto"> primes a frame — at once, stacked
  // on top of the spine's own 2. Phones have a hard concurrent-decoder
  // ceiling; past it, frames silently drop instead of erroring, which is
  // exactly "plays smooth, then stutters and never finishes" rather than any
  // visible failure. Each branch still preloads itself the moment it is
  // actually entered (see BranchOverlay's playForward), so this only trades
  // away the speculative head start, not correctness.
  useEffect(() => {
    if (node !== "studio") return;
    if (isMobileTier()) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    Object.values(branchRefs.current).forEach((c) => c?.preload());
  }, [node]);

  return (
    <JourneyCtx.Provider
      value={{
        node,
        isAnimating,
        navOpen,
        setNavOpen,
        goTo,
        jumpTo,
        goBack,
        reportSpinePosition,
        registerSpine,
        registerBranch,
      }}
    >
      {children}
    </JourneyCtx.Provider>
  );
}

export function useJourney() {
  const ctx = useContext(JourneyCtx);
  if (!ctx) throw new Error("useJourney must be used within JourneyProvider");
  return ctx;
}
