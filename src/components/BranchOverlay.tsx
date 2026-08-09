"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useJourney } from "@/context/JourneyContext";
import {
  BRANCH_SPEED,
  EDGE_DURATION,
  EDGE_VIDEO,
  NodeId,
} from "@/lib/journey";

type Props = {
  node: "about" | "portfolio" | "contact" | "services";
  children: ReactNode;
  /** Colour the overlay rests on once the transition completes (matches the video's final frame). */
  restBackground: string;
};

export default function BranchOverlay({ node, children, restBackground }: Props) {
  const { node: currentNode, registerBranch } = useJourney();

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  // Branch clips use preload="none" so the ~13MB of studio-exit video isn't
  // fetched on first paint; kick the real load off only when this branch is
  // first entered.
  const loadTriggeredRef = useRef(false);

  const clips = EDGE_VIDEO[node as NodeId] ?? [];
  const durations = EDGE_DURATION[node as NodeId] ?? [];
  const speed = BRANCH_SPEED[node as NodeId] ?? 1.5;
  const totalNative = durations.reduce((a, b) => a + b, 0);
  const totalWall = totalNative / speed;

  const setVideoTime = (nativeT: number) => {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const d = durations[i];
      const v = videoRefs.current[i];
      if (!v) continue;
      if (nativeT >= acc && nativeT <= acc + d) {
        v.style.opacity = "1";
        v.currentTime = Math.min(d, Math.max(0, nativeT - acc));
      } else if (nativeT < acc) {
        v.style.opacity = "0";
        v.currentTime = 0;
      } else {
        v.style.opacity = "0";
        v.currentTime = d;
      }
      acc += d;
    }
  };

  const runTween = (from: number, to: number, onDone: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const wallDuration = (Math.abs(to - from) / totalNative) * totalWall * 1000;
    const dur = Math.max(80, wallDuration);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 2);
      const nativeT = from + (to - from) * eased;
      setVideoTime(nativeT);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        onDone();
      }
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    registerBranch(node, {
      playForward: () =>
        new Promise<void>((resolve) => {
          activeRef.current = true;
          if (!loadTriggeredRef.current) {
            loadTriggeredRef.current = true;
            videoRefs.current.forEach((v) => v?.load());
          }
          const root = rootRef.current;
          if (root) {
            root.style.pointerEvents = "auto";
            root.style.opacity = "1";
          }
          if (contentRef.current) contentRef.current.style.opacity = "0";
          if (root) root.scrollTop = 0;
          setVideoTime(0);
          runTween(0, totalNative, () => {
            if (contentRef.current) {
              contentRef.current.style.opacity = "1";
              contentRef.current.style.pointerEvents = "auto";
            }
            resolve();
          });
        }),
      playReverse: () =>
        new Promise<void>((resolve) => {
          if (contentRef.current) {
            contentRef.current.style.opacity = "0";
            contentRef.current.style.pointerEvents = "none";
          }
          runTween(totalNative, 0, () => {
            const root = rootRef.current;
            if (root) {
              root.style.opacity = "0";
              root.style.pointerEvents = "none";
            }
            activeRef.current = false;
            resolve();
          });
        }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const isTarget = currentNode === node;

  return (
    <div
      ref={rootRef}
      className="branch-overlay"
      style={{ opacity: 0, pointerEvents: "none", background: restBackground }}
      aria-hidden={!isTarget}
    >
      <div className="branch-video-stack">
        {clips.map((src, i) => (
          <video
            key={src}
            ref={(el) => {
              videoRefs.current[i] = el;
            }}
            className="branch-video"
            src={src}
            muted
            playsInline
            preload="none"
            style={{ opacity: i === 0 ? 1 : 0 }}
          />
        ))}
      </div>
      <div ref={contentRef} className="branch-content" style={{ opacity: 0, pointerEvents: "none" }}>
        {children}
      </div>
    </div>
  );
}
