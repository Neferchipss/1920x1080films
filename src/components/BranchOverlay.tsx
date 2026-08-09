"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useJourney } from "@/context/JourneyContext";
import {
  BRANCH_SPEED,
  EDGE_DURATION,
  EDGE_VIDEO,
  NodeId,
  REVERSE_SPEED_MULTIPLIER,
} from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";
import { motionCurveMultiplier } from "@/lib/motionCurve";

type Props = {
  node: "about" | "portfolio" | "contact" | "services";
  children: ReactNode;
  /** Colour the overlay rests on once the transition completes (matches the video's final frame). */
  restBackground: string;
};

export default function BranchOverlay({ node, children, restBackground }: Props) {
  const { node: currentNode, isAnimating, registerBranch, goBack } = useJourney();

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const cancelForwardRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(false);
  // Branch clips use preload="none" so the ~13MB of studio-exit video isn't
  // fetched on first paint; kick the real load off only when this branch is
  // first entered.
  const loadTriggeredRef = useRef(false);

  const clips = EDGE_VIDEO[node as NodeId] ?? [];
  const durations = EDGE_DURATION[node as NodeId] ?? [];
  const speeds = BRANCH_SPEED[node as NodeId] ?? [1.5];
  const totalNative = durations.reduce((a, b) => a + b, 0);

  const clipIndexAt = (nativeT: number) => {
    let acc = 0;
    for (let i = 0; i < durations.length; i++) {
      if (nativeT > acc && nativeT <= acc + durations[i]) return i;
      acc += durations[i];
    }
    return durations.length - 1;
  };

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

  // Scrubbing (repeated currentTime seeks) reads as a slideshow rather than
  // a video. Forward entrance always plays in one direction, so drive it
  // with real play()/playbackRate — the browser's normal decode pipeline —
  // and chain clips on their native "ended" event instead.
  const playForwardNative = (onDone: () => void) => {
    let i = 0;
    let cancelled = false;
    cancelForwardRef.current = () => {
      cancelled = true;
    };

    const playNext = () => {
      if (cancelled) return;
      if (i >= clips.length) {
        onDone();
        return;
      }
      const v = videoRefs.current[i];
      if (!v) {
        i++;
        playNext();
        return;
      }
      videoRefs.current.forEach((vv, idx) => {
        if (vv) vv.style.opacity = idx === i ? "1" : "0";
      });
      v.currentTime = 0;
      const baseRate = speeds[i] ?? speeds[speeds.length - 1] ?? 1.5;
      const dur = durations[i] || 1;
      v.playbackRate = baseRate * motionCurveMultiplier(0);

      // Prime the next clip's first frame now, at the start of this clip's
      // multi-second run, rather than at the exact instant of handoff — that
      // was the jitter: the next clip only got seeked to 0 as it became
      // visible, so it could still be painting a stale/blank frame for a
      // beat before it caught up.
      const nextV = videoRefs.current[i + 1];
      if (nextV) {
        try {
          nextV.currentTime = 0;
        } catch {}
      }

      const updateRate = () => {
        if (cancelled || v.ended) return;
        v.playbackRate = Math.min(10, Math.max(0.1, baseRate * motionCurveMultiplier(v.currentTime / dur)));
        requestAnimationFrame(updateRate);
      };
      requestAnimationFrame(updateRate);

      const onEnded = () => {
        v.removeEventListener("ended", onEnded);
        if (cancelled) return;
        i++;
        playNext();
      };
      v.addEventListener("ended", onEnded);
      v.play().catch(() => {});
    };
    playNext();
  };

  // Exit can't use native play() — HTML5 video has no reliable reverse
  // playback — so it still scrubs, but at each clip's own reverse rate
  // (forward speed x REVERSE_SPEED_MULTIPLIER) rather than one blended rate
  // across the whole sequence.
  const runReverse = (from: number, onDone: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let nativeT = from;
    let lastTs: number | null = null;

    const step = (now: number) => {
      const dt = lastTs == null ? 0 : Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      const idx = clipIndexAt(nativeT);
      const rate = (speeds[idx] ?? speeds[speeds.length - 1] ?? 1.5) * REVERSE_SPEED_MULTIPLIER;
      nativeT = Math.max(0, nativeT - rate * dt);
      setVideoTime(nativeT);
      if (nativeT > 0) {
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
          playForwardNative(() => {
            if (contentRef.current) {
              contentRef.current.style.opacity = "1";
              contentRef.current.style.pointerEvents = "auto";
            }
            resolve();
          });
        }),
      playReverse: () =>
        new Promise<void>((resolve) => {
          cancelForwardRef.current?.();
          cancelForwardRef.current = null;
          videoRefs.current.forEach((v) => v?.pause());
          if (contentRef.current) {
            contentRef.current.style.opacity = "0";
            contentRef.current.style.pointerEvents = "none";
          }
          runReverse(totalNative, () => {
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
      cancelForwardRef.current?.();
    };
  }, []);

  const isTarget = currentNode === node;

  // Scrolling up while already at the top of a branch's content is the same
  // "scroll back at a checkpoint" gesture as on the spine — reverse to studio.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (!isTarget || isAnimating) return;
      if (e.deltaY < 0 && root.scrollTop <= 2) {
        e.preventDefault();
        goBack();
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [isTarget, isAnimating, goBack]);

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
            src={withBasePath(src)}
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
