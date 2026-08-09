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

export type SpineController = {
  /** Animate the pinned scroll spine to rest exactly at this node. */
  goTo: (node: "landing" | "facade" | "studio") => Promise<void>;
};

export type BranchController = {
  playForward: () => Promise<void>;
  playReverse: () => Promise<void>;
};

type JourneyState = {
  node: NodeId;
  isAnimating: boolean;
  navOpen: boolean;
};

type JourneyApi = JourneyState & {
  goTo: (target: NodeId) => Promise<void>;
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

    try {
      for (const n of up) {
        if (isBranchNode(n)) {
          await branchRefs.current[n]?.playReverse();
        } else if (n === "studio" || n === "facade") {
          const parent = PARENT[n] as "landing" | "facade";
          await spineRef.current?.goTo(parent);
        }
        const parent = PARENT[n];
        if (parent) {
          nodeRef.current = parent;
          setNode(parent);
        }
      }

      for (const n of down) {
        if (isBranchNode(n)) {
          await branchRefs.current[n]?.playForward();
        } else {
          await spineRef.current?.goTo(n as "landing" | "facade" | "studio");
        }
        nodeRef.current = n;
        setNode(n);
      }
    } finally {
      setIsAnimating(false);
      busyRef.current = false;
    }
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

  return (
    <JourneyCtx.Provider
      value={{
        node,
        isAnimating,
        navOpen,
        setNavOpen,
        goTo,
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
