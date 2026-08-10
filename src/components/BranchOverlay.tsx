"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useJourney } from "@/context/JourneyContext";
import {
  BRANCH_SPEED,
  EDGE_DURATION,
  EDGE_DURATION_REVERSE,
  EDGE_VIDEO,
  EDGE_VIDEO_REVERSE,
  NodeId,
  REVERSE_SPEED_MULTIPLIER,
} from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";
import { isMobileTier, tierSrc } from "@/lib/videoTier";

type Props = {
  node: "about" | "portfolio" | "contact" | "services";
  children: ReactNode;
  /** Colour the overlay rests on once the transition completes (matches the video's final frame). */
  restBackground: string;
};

/**
 * Guard rail only. Every clip is now cut to the length it should play for, so
 * the configured rate is 1 and this never binds — but a bad EDGE_DURATION
 * entry should not be able to ask the decoder for something absurd.
 *
 * It used to matter: the entrance's motion curve peaked at 3.2x on top of a
 * 4.5x base (14.4x on the first frame) and the exit asked for 28.8x. What
 * that actually bought was dropped frames — the media clock ran, the renderer
 * did not — which is most of why the transitions stuttered on phones.
 */
const MAX_PLAYBACK_RATE = 4;

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
  // Branch clips use preload="none" so none of the studio-exit video is
  // fetched on first paint; kick the real load off only when this branch is
  // first entered (or speculatively prefetched from studio).
  const loadTriggeredRef = useRef(false);
  const revLoadTriggeredRef = useRef(false);

  const clips = EDGE_VIDEO[node as NodeId] ?? [];
  const durations = EDGE_DURATION[node as NodeId] ?? [];
  const speeds = BRANCH_SPEED[node as NodeId] ?? [1];

  // The exit assets are the entrance shots encoded back-to-front, so the
  // sequence runs through them in the opposite order — and, being their own
  // encodes cut to half the entrance's length, they carry their own timings
  // rather than deriving them from the entrance's.
  const revClips = EDGE_VIDEO_REVERSE[node as NodeId] ?? [];
  const fwdSpeeds = perClip(speeds, clips.length, 1);
  const fwdDurations = perClip(durations, clips.length, 1);
  // The exit clips are their own encodes at their own (shorter) lengths, so
  // their durations come from their own table rather than being inferred from
  // the entrance's.
  const revDurations = perClip(
    EDGE_DURATION_REVERSE[node as NodeId] ?? [...fwdDurations].reverse(),
    revClips.length,
    1
  );
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
  // a video — and on a 2K/60fps source a backward seek takes ~840ms, so
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
    onDone: () => void
  ) => {
    let i = 0;
    let cancelled = false;
    cancelSequenceRef.current = () => {
      cancelled = true;
    };

    // Both entries into this function are synchronous with the click or wheel
    // gesture that triggered the navigation, so this is the one moment we can
    // clear iOS's per-element autoplay restriction for the *whole* chain. Only
    // clip 0 plays inside the gesture; every clip after it is started from the
    // previous one's "ended" handler, where there is no gesture in scope — so
    // on a device that blocks muted autoplay (Low Power Mode, or Safari's
    // Auto-Play set to "Never") clip 1 onwards would be rejected, and the
    // multi-clip branches would jump straight to their safety timeout.
    for (let k = 0; k < count; k++) {
      const v = refs[k];
      if (!v) continue;
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          // Leave whichever clip the chain has since started alone.
          if (k !== i || cancelled) v.pause();
        }).catch(() => {});
      }
    }

    // There used to be a motion curve here, ramping playbackRate down across
    // each clip to blast through the near-static frame it opens on, read
    // backwards for exits. It is gone: the retimed encodes compressed that
    // dead frame by the same factor as everything else (it is now a handful
    // of frames), and varying the rate above 1 only costs presented frames.
    // Direction no longer changes the timing either — the exit assets are
    // cut shorter rather than played faster.

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
      const baseRate = Math.min(MAX_PLAYBACK_RATE, Math.max(0.1, seqSpeeds[i]));
      const dur = seqDurations[i] || 1;
      v.playbackRate = baseRate;

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

      // A constant rate means no per-frame rAF loop rewriting playbackRate
      // while the clip runs — one less thing competing with the decoder on a
      // phone, for a value that never changed anyway.

      // Unlike the spine (which polls currentTime itself every frame),
      // this chain waits on the clip's own "ended" event — and a clip the
      // decoder cannot keep up with may never fire it, silently stalling
      // forever. That is far less likely now that everything plays at rate 1
      // on 1080p sources, but the consequence is severe: since
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

  // Assign the device-appropriate encode on mount rather than in JSX — the
  // tier can only be decided on the client, and these are preload="none" so
  // setting src costs nothing until loadAll() upgrades them. Same reasoning as
  // the spine's tier effect; see src/lib/videoTier.ts.
  useEffect(() => {
    const mobile = isMobileTier();
    clips.forEach((path, i) => {
      const v = videoRefs.current[i];
      if (v) v.src = withBasePath(tierSrc(path, mobile));
    });
    revClips.forEach((path, i) => {
      const v = revVideoRefs.current[i];
      if (v) v.src = withBasePath(tierSrc(path, mobile));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    registerBranch(node, {
      preload,
      playForward: () =>
        new Promise<void>((resolve) => {
          activeRef.current = true;
          preload();
          const root = rootRef.current;
          if (root) {
            root.style.pointerEvents = "auto";
            root.style.opacity = "1";
            // Bring the content into the render tree now, at the *start* of
            // the entrance, so its images have the whole clip to load rather
            // than popping in after it. See the data-content rule in
            // globals.css for why they are held back until this point.
            root.dataset.content = "live";
          }
          if (contentRef.current) contentRef.current.style.opacity = "0";
          if (root) root.scrollTop = 0;
          revVideoRefs.current.forEach((v) => {
            if (v) v.style.opacity = "0";
          });
          setVideoTime(0);
          playSequence(videoRefs.current, clips.length, fwdDurations, fwdSpeeds, () => {
            if (contentRef.current) {
              contentRef.current.style.opacity = "1";
              contentRef.current.style.pointerEvents = "auto";
            }
            // Only now — starting the exit clips' download alongside the
            // entrance made them compete with the video actually on screen for
            // both bandwidth and decoder setup, which measured as ~17% of the
            // entrance's frames dropped on a throttled phone. The user reads
            // the page for seconds before they can exit, which is ample.
            preloadReverse();
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
          playSequence(revVideoRefs.current, revClips.length, revDurations, revSpeeds, () => {
            const root = rootRef.current;
            if (root) {
              root.style.opacity = "0";
              root.style.pointerEvents = "none";
              // Back out of the render tree — this also pauses and unloads
              // every film loop inside, via their IntersectionObservers.
              root.dataset.content = "idle";
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
      data-content="idle"
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
