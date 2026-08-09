"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useJourney } from "@/context/JourneyContext";
import {
  BRANCH_SPEED,
  EDGE_DURATION,
  EDGE_VIDEO,
  EDGE_VIDEO_REVERSE,
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

/**
 * The entrance's motion curve peaks at 3.2x, so its 4.5x base already asks
 * for 14.4x on the first frame; the exit's 9x base would ask for 28.8x.
 * 16 is the highest rate HTMLMediaElement actually honours, so both the
 * initial and per-frame rate writes are clamped to it.
 */
const MAX_PLAYBACK_RATE = 16;

/** Pad a per-clip config array out to `n`, repeating its last entry. */
const perClip = (arr: number[], n: number, fallback: number) =>
  Array.from({ length: n }, (_, i) => arr[i] ?? arr[arr.length - 1] ?? fallback);

export default function BranchOverlay({ node, children, restBackground }: Props) {
  const { node: currentNode, isAnimating, registerBranch, goBack } = useJourney();

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const revVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const cancelSequenceRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(false);
  // Branch clips use preload="none" so the ~13MB of studio-exit video isn't
  // fetched on first paint; kick the real load off only when this branch is
  // first entered.
  const loadTriggeredRef = useRef(false);
  const revLoadTriggeredRef = useRef(false);

  const clips = EDGE_VIDEO[node as NodeId] ?? [];
  const durations = EDGE_DURATION[node as NodeId] ?? [];
  const speeds = BRANCH_SPEED[node as NodeId] ?? [1.5];

  // The exit assets are the entrance shots encoded back-to-front, so the
  // sequence runs through them in the opposite order, and each one's timing
  // comes from its entrance counterpart (at REVERSE_SPEED_MULTIPLIER times
  // that clip's own forward speed).
  const revClips = EDGE_VIDEO_REVERSE[node as NodeId] ?? [];
  const fwdSpeeds = perClip(speeds, clips.length, 1.5);
  const fwdDurations = perClip(durations, clips.length, 1);
  const revDurations = [...fwdDurations].reverse();
  const revSpeeds = [...fwdSpeeds].reverse().map((s) => s * REVERSE_SPEED_MULTIPLIER);

  const setVideoTime = (nativeT: number) => {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const d = fwdDurations[i];
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
  // a video — and on these 2K/60fps sources a backward seek takes ~840ms, so
  // a scrubbed transition renders essentially one frame. Both directions
  // therefore play real, forward video with play()/playbackRate — the
  // browser's normal decode pipeline — chaining clips on the native "ended"
  // event. The exit gets there by playing pre-reversed encodes of the same
  // shots (see EDGE_VIDEO_REVERSE).
  const playSequence = (
    refs: Array<HTMLVideoElement | null>,
    count: number,
    seqDurations: number[],
    seqSpeeds: number[],
    reversed: boolean,
    onDone: () => void
  ) => {
    let i = 0;
    let cancelled = false;
    cancelSequenceRef.current = () => {
      cancelled = true;
    };

    // The motion curve exists to blast through the near-static frame the
    // clips hold on. In a reversed encode that frame is at the *end*, not
    // the start, so the curve has to be read backwards — otherwise an exit
    // sprints through its most interesting motion and then lingers on the
    // dead frame, at several times the decode cost.
    const rate = (base: number, t: number) =>
      Math.min(
        MAX_PLAYBACK_RATE,
        Math.max(0.1, base * motionCurveMultiplier(reversed ? 1 - t : t))
      );

    const playNext = () => {
      if (cancelled) return;
      if (i >= count) {
        onDone();
        return;
      }
      const v = refs[i];
      if (!v) {
        i++;
        playNext();
        return;
      }
      refs.forEach((vv, idx) => {
        if (vv) vv.style.opacity = idx === i ? "1" : "0";
      });
      v.currentTime = 0;
      const baseRate = seqSpeeds[i];
      const dur = seqDurations[i] || 1;
      v.playbackRate = rate(baseRate, 0);

      // Prime the next clip's first frame now, at the start of this clip's
      // multi-second run, rather than at the exact instant of handoff — that
      // was the jitter: the next clip only got seeked to 0 as it became
      // visible, so it could still be painting a stale/blank frame for a
      // beat before it caught up.
      const nextV = refs[i + 1];
      if (nextV) {
        try {
          nextV.currentTime = 0;
        } catch {}
      }

      const updateRate = () => {
        if (cancelled || v.ended) return;
        v.playbackRate = rate(baseRate, v.currentTime / dur);
        requestAnimationFrame(updateRate);
      };
      requestAnimationFrame(updateRate);

      // Unlike the spine (which polls currentTime itself every frame),
      // this chain waits on the clip's own "ended" event — and at a high
      // sustained playbackRate a 2K clip can fail to decode fast enough for
      // the browser to ever fire it, silently stalling forever. Since
      // JourneyContext awaits this whole promise before releasing its
      // navigation lock, a stall here wouldn't just break this transition —
      // it would permanently block *every* future navigation in either
      // direction. A generous timeout guarantees this always resolves one
      // way or another.
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        v.removeEventListener("ended", onEnded);
        if (cancelled) return;
        i++;
        playNext();
      };
      const onEnded = () => finish();
      v.addEventListener("ended", onEnded);
      const safety = setTimeout(finish, Math.max(400, (dur / baseRate) * 1000 * 2));
      v.play().catch(() => {});
    };
    playNext();
  };

  const loadAll = (refs: Array<HTMLVideoElement | null>) => {
    // preload="none" in the markup keeps these from fetching on first
    // paint; upgrading to "auto" here, right as we actually want buffering
    // to start, is a stronger signal than an explicit load() alone — some
    // browsers still only fetch metadata after load() while preload stays
    // "none".
    refs.forEach((v) => {
      if (!v) return;
      v.preload = "auto";
      v.load();
    });
  };

  const preload = () => {
    if (loadTriggeredRef.current) return;
    loadTriggeredRef.current = true;
    loadAll(videoRefs.current);
  };

  // Exit clips are only worth fetching once this branch is actually entered
  // — buffering all four branches' exits alongside their entrances would
  // roughly double what studio prefetches, and the entrance itself plus the
  // user's dwell on the content is ample head start.
  const preloadReverse = () => {
    if (revLoadTriggeredRef.current) return;
    revLoadTriggeredRef.current = true;
    loadAll(revVideoRefs.current);
  };

  useEffect(() => {
    registerBranch(node, {
      preload,
      playForward: () =>
        new Promise<void>((resolve) => {
          activeRef.current = true;
          preload();
          preloadReverse();
          const root = rootRef.current;
          if (root) {
            root.style.pointerEvents = "auto";
            root.style.opacity = "1";
          }
          if (contentRef.current) contentRef.current.style.opacity = "0";
          if (root) root.scrollTop = 0;
          revVideoRefs.current.forEach((v) => {
            if (v) v.style.opacity = "0";
          });
          setVideoTime(0);
          playSequence(videoRefs.current, clips.length, fwdDurations, fwdSpeeds, false, () => {
            if (contentRef.current) {
              contentRef.current.style.opacity = "1";
              contentRef.current.style.pointerEvents = "auto";
            }
            resolve();
          });
        }),
      playReverse: () =>
        new Promise<void>((resolve) => {
          cancelSequenceRef.current?.();
          cancelSequenceRef.current = null;
          preloadReverse();
          videoRefs.current.forEach((v) => {
            v?.pause();
            if (v) v.style.opacity = "0";
          });
          if (contentRef.current) {
            contentRef.current.style.opacity = "0";
            contentRef.current.style.pointerEvents = "none";
          }
          playSequence(revVideoRefs.current, revClips.length, revDurations, revSpeeds, true, () => {
            const root = rootRef.current;
            if (root) {
              root.style.opacity = "0";
              root.style.pointerEvents = "none";
            }
            revVideoRefs.current.forEach((v) => {
              v?.pause();
              if (v) v.style.opacity = "0";
            });
            activeRef.current = false;
            resolve();
          });
        }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      cancelSequenceRef.current?.();
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
        {revClips.map((src, i) => (
          <video
            key={src}
            ref={(el) => {
              revVideoRefs.current[i] = el;
            }}
            className="branch-video"
            src={withBasePath(src)}
            muted
            playsInline
            preload="none"
            style={{ opacity: 0 }}
          />
        ))}
      </div>
      <div ref={contentRef} className="branch-content" style={{ opacity: 0, pointerEvents: "none" }}>
        {children}
      </div>
    </div>
  );
}
