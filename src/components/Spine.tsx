"use client";

import { useEffect, useRef } from "react";
import { useJourney } from "@/context/JourneyContext";
import { BOUNDS, REST_PROGRESS, SPINE_VH_TOTAL, clamp01 } from "@/lib/spineLayout";
import { NAV_LABEL, isSpineNode } from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";
import { isMobileTier, tierSrc } from "@/lib/videoTier";

// Fallbacks only — the real durations are read off the elements once their
// metadata lands (see durRefs). Holding a clip at a hardcoded duration that
// is slightly short of the real one meant every arrival ended with a small
// *backward* seek, which on a 2560x1440 source costs hundreds of ms of
// decode — the stutter that used to hit right as a transition came to rest.
// Both spine clips are pre-retimed to their on-screen length (see below), so
// these are the real shipped durations, not the 12s / 15.07s of the masters
// they were cut from.
const DUR1_FALLBACK = 3.45;
const DUR2_FALLBACK = 1.9833;

// Paginated checkpoint model: the spine holds at landing/facade/studio and
// only moves when the user picks a direction. That single gesture commits
// to an automatic play through to the adjacent checkpoint (a fixed cruise
// speed, not proportional to how hard they scrolled) which then halts
// again — further input mid-transition is ignored until it settles.
type Checkpoint = "landing" | "facade" | "studio";
const SPINE_CHECKPOINTS: Checkpoint[] = ["landing", "facade", "studio"];
const CRUISE_SPEED = 0.09; // progress/sec through the landing->facade clip and hold zones
/**
 * "Studio animations" (the facade->studio clip) get an explicit native-speed
 * multiplier instead of the abstract cruise speed, same pattern as branch
 * clips. Both directions target ~2s and the clips are pre-retimed to exactly
 * that length, so the rate is 1 — i.e. native speed.
 *
 * It used to be 7.5, against the 15.072s master. That does not work, and the
 * failure is invisible in `currentTime`: at 7.5x on a 2560x1440/60fps source
 * Chromium cannot decode fast enough to keep the *renderer* alongside the
 * media clock. Instrumenting a real leg with requestVideoFrameCallback showed
 * the media clock reaching 15.07s while the last frame actually presented to
 * the compositor was at mediaTime 6.0s — 567 of 896 frames dropped. driveClip
 * then pauses the element the moment currentTime hits the end, which kills the
 * renderer's chance to catch up, so the picture froze roughly 40% into the
 * move and the camera never arrived at the studio. Playing a clip that is
 * already cut to length at rate 1 presents every frame instead.
 *
 * Every transition clip on the site is built this way now — regenerate them
 * with `scripts/build_transition_clips.sh`.
 */
const STUDIO_ANIM_FORWARD_RATE = 1;
const STUDIO_ANIM_REVERSE_RATE = 1;
const VELOCITY_EASE = 0.12; // per-frame ease into CRUISE_SPEED at the start of a transition
// Both clips play at ~1. This only catches a mis-sized asset; anything
// meaningfully above 1 would start costing presented frames again.
const MAX_RATE = 4;

// Backward travel can't be done by winding `currentTime` down: a single
// backward seek on a 2K/60fps source measures ~840ms, and consecutive
// currentTime writes replace each other's pending seek, so a scrubbed reverse
// presented roughly one frame for the whole transition. These are the same
// shots pre-encoded back-to-front, so a backward leg runs through the
// browser's normal decode pipeline exactly like a forward one.
const REV_VIDEO_1 = "/video/landing-facade-rev.mp4";
const REV_VIDEO_2 = "/video/facade-studio-rev.mp4";

/** Which clip, if any, is currently owned by native playback — applyProgress
 *  must not seek a video the playback driver is running. */
type Driven = { which: 1 | 2; dir: 1 | -1 } | null;

/**
 * How long a driven clip may sit with a frozen `currentTime` before the spine
 * gives up on video for the rest of the journey.
 *
 * Every play() on the spine is issued from the rAF loop and its rejection is
 * swallowed (`.catch(() => {})`), and driveClip reads progress back *out* of
 * currentTime — so anything that stops the media clock stops the whole site,
 * silently and permanently. Two real conditions do that on phones and neither
 * happens on a desktop:
 *
 *   - iOS refuses muted inline autoplay in Low Power Mode, and when
 *     Settings > Safari > Auto-Play is "Never". play() rejects, currentTime
 *     stays 0, and the spine never leaves landing.
 *   - The clips are 1080p60 at 13-15 Mbit/s (5.8 MB for landing -> facade).
 *     On mobile data the element stalls mid-clip waiting on the network and
 *     the media clock halts there instead.
 *
 * Both used to read as "the site loads but nothing animates". The gesture
 * priming below fixes the first outright; this watchdog is the backstop that
 * guarantees the user always arrives at the next checkpoint either way.
 */
const STALL_LIMIT_MS = 1500;

/**
 * Reduced motion skips the clips, which means the videos may never play at
 * all — and a <video> that has never played paints nothing on iOS Safari, so
 * "no animation" degraded into "black screen" rather than into a still frame.
 * These are the same three scenes as flat images, shown instead of the video
 * stack whenever motion is suppressed. No decoder is involved at all, which
 * is also the cheapest the journey can possibly be on a weak device.
 */
const CHECKPOINT_STILL: Record<Checkpoint, string> = {
  landing: "/img/stills/landing.jpg",
  facade: "/img/stills/facade.jpg",
  studio: "/img/brand/studio-still.jpg",
};

// Source-pixel bounding boxes measured directly off the 1600x900 studio
// still (assets/studio.jpeg), one per interactive object. Positioned at
// runtime against the video's actual object-fit:cover geometry so hotspots
// track the real objects regardless of viewport aspect ratio.
const SOURCE_W = 1600;
const SOURCE_H = 900;
const HOTSPOT_BOXES: Record<
  "about" | "portfolio" | "contact" | "services",
  { x: number; y: number; w: number; h: number }
> = {
  about: { x: 46, y: 152, w: 172, h: 428 }, // the framed print, left wall
  portfolio: { x: 690, y: 500, w: 155, h: 255 }, // camera on the tripod, centre
  contact: { x: 925, y: 448, w: 165, h: 168 }, // iMac on the desk, back right
  services: { x: 1330, y: 148, w: 270, h: 410 }, // equipment pegboard, right wall
};

/** Reading order for the touch fallback list; the hotspots keep their own
 *  spatial arrangement. */
const STUDIO_OPTIONS = ["portfolio", "about", "services", "contact"] as const;

const COUNTERS = [
  { value: 100, suffix: "+", label: "Luxury Homes" },
  { value: 4500, suffix: "+", label: "Edited Images" },
  { value: 50, suffix: "+", label: "Interior Designers" },
  { value: 25, suffix: "+", label: "Commercial Projects" },
  { value: 10, suffix: "M+", label: "Sq Ft Captured" },
];

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-IN");
}

export default function Spine() {
  const { node, registerSpine, goTo, isAnimating, reportSpinePosition } = useJourney();

  const scrollerRef = useRef<HTMLDivElement>(null);
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
  const rev1Ref = useRef<HTMLVideoElement>(null);
  const rev2Ref = useRef<HTMLVideoElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  const landingLogoRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const facadeRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const stillRef = useRef<HTMLImageElement>(null);
  const brandMarkRef = useRef<HTMLDivElement>(null);
  const sceneFooterRef = useRef<HTMLDivElement>(null);
  const counterRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const hotspotRefs = useRef<Partial<Record<keyof typeof HOTSPOT_BOXES, HTMLButtonElement | null>>>({});

  const progressRef = useRef(REST_PROGRESS.landing);
  const velocityRef = useRef(0);
  const haltedRef = useRef(true);
  const travelDirRef = useRef<0 | 1 | -1>(0);
  const checkpointIndexRef = useRef(0);
  const countersRafRef = useRef<number | null>(null);
  const countersActiveRef = useRef(false);
  const lastTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const nodeRef = useRef(node);
  const isAnimatingRef = useRef(isAnimating);

  const dur1Ref = useRef(DUR1_FALLBACK);
  const dur2Ref = useRef(DUR2_FALLBACK);
  const revDur1Ref = useRef(DUR1_FALLBACK);
  const revDur2Ref = useRef(DUR2_FALLBACK);
  const revLoadedRef = useRef(false);
  const clip2LoadedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  /** The watchdog has caught a dead media clock on the leg in flight: finish
   *  it on the stills rather than freezing on a clip that is not advancing. */
  const stillsModeRef = useRef(false);
  /**
   * How many legs the watchdog has had to rescue, and whether it has given up
   * on video for good.
   *
   * A single stall is not proof the device can't play the clips — a cold
   * decoder, a browser that hasn't got the GPU path warm yet, or one slow
   * buffer can all cost more than STALL_LIMIT_MS on the very first leg and
   * then be fine forever after. Latching the stills permanently on that first
   * stumble throws the whole animated journey away for the rest of the
   * session, which is a much worse outcome than the stall itself. So the first
   * stall only rescues its own leg, and the next leg tries video again;
   * two stalls is a pattern, and that latches.
   */
  const stallCountRef = useRef(0);
  const stillsLatchedRef = useRef(false);
  /** Elements that have had play() called on them inside a real user gesture.
   *  WebKit's autoplay restriction is per element, so this is per element. */
  const primedRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());
  /** Watchdog bookkeeping for the clip the driver currently owns. */
  const stallMsRef = useRef(0);
  const lastClipTimeRef = useRef(-1);
  /** Which clip the playback driver currently owns. Held across frames so a
   *  clip that has been handed the leg keeps it until it plays out — deciding
   *  per frame from `p` alone let a boundary frame fall between the zones,
   *  which handed the hidden forward clip a multi-second seek mid-reverse. */
  const activeClipRef = useRef<1 | 2 | null>(null);

  /** A programmatic (journey-driven) travel in flight — runs leg after leg
   *  without halting on the checkpoints it passes through. */
  const programmaticRef = useRef<{ target: Checkpoint; resolve: () => void } | null>(null);

  useEffect(() => {
    nodeRef.current = node;
    isAnimatingRef.current = isAnimating;
  }, [node, isAnimating]);

  const showStillFor = (cp: Checkpoint) => {
    const el = stillRef.current;
    if (!el) return;
    if (!reducedMotionRef.current && !stillsModeRef.current) {
      el.style.opacity = "0";
      return;
    }
    const next = withBasePath(CHECKPOINT_STILL[cp]);
    if (!el.src.endsWith(CHECKPOINT_STILL[cp])) el.src = next;
    el.style.opacity = "1";
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotionRef.current = mq.matches;
      showStillFor(SPINE_CHECKPOINTS[checkpointIndexRef.current]);
    };
    sync();
    // Safari only grew addEventListener on MediaQueryList in 14; fall back to
    // the deprecated addListener rather than throwing during mount, which
    // would take the whole spine down with it.
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else mq.addListener(sync);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sync);
      else mq.removeListener(sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncScrollFromProgress = (p: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    if (total <= 0) return;
    const y = el.offsetTop + p * total;
    if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo(0, y);
  };

  // Skips redundant seeks (video.currentTime writes are real decode work,
  // not free) when the target barely moved since the last frame. The hold
  // positions at either end of a clip pass a much larger tolerance: a clip
  // that just played out sits a few hundredths off its nominal end, and
  // "correcting" that is a backward seek costing hundreds of milliseconds.
  const seekVideo = (v: HTMLVideoElement, t: number, eps = 0.004) => {
    if (Math.abs(v.currentTime - t) > eps) v.currentTime = t;
  };
  const HOLD_EPS = 0.25;

  const allVideos = () => [video1Ref.current, video2Ref.current, rev1Ref.current, rev2Ref.current];

  const pauseAllExcept = (keep: HTMLVideoElement | null) => {
    allVideos().forEach((v) => {
      if (v && v !== keep && !v.paused) v.pause();
    });
  };

  // Repeatedly seeking video.currentTime is fundamentally not smooth: every
  // seek is a random-access decode, and doing 60 of them a second reads as a
  // slideshow — or, on these 2K sources, as a single frame, because pending
  // seeks get replaced faster than they complete. So whenever we're moving
  // through an active clip we drive a real element with play()/playbackRate
  // and let the browser's normal decode pipeline render it; progress is then
  // read back from currentTime rather than dictating it. Backward legs do
  // exactly the same thing against the pre-reversed encode. Returns the new
  // progress, or null if the caller should fall back to plain cruising.
  const driveClip = (
    v: HTMLVideoElement,
    speed: number,
    zoneStart: number,
    zoneEnd: number,
    dur: number,
    dir: 1 | -1,
    fresh = false
  ): number | null => {
    if (speed <= 0.002) return null;
    // A clip that has run out must be recognised as finished *before* anything
    // touches play(). HTMLMediaElement.play() on an element sitting at its
    // duration rewinds it to 0, so the old order — play() first, "are we at
    // the end?" second — turned an overshoot into a replay: the end test only
    // covers the last 0.03s, but a leg advances currentTime by rate/60 per
    // frame (0.058s on the landing<->facade clip at 3.5x), so a frame
    // regularly stepped straight past the window to `ended`, got rewound by
    // the next frame's play(), and reported progress back at the far end of
    // the zone. That is the spine looping the same clip forever instead of
    // coming to rest on a checkpoint.
    //
    // The rewind is still wanted on the frame the driver *claims* the clip
    // (re-entering a leg whose clip is parked at its end), so that one frame
    // asks for it explicitly rather than getting it as a side effect.
    const spent = v.ended || v.currentTime >= dur - 0.03;
    if (fresh) {
      if (spent) {
        try {
          v.currentTime = 0;
        } catch {}
      }
    } else if (spent) {
      if (!v.paused) v.pause();
      return dir > 0 ? zoneEnd : zoneStart;
    }
    if (v.paused) v.play().catch(() => {});
    const span = zoneEnd - zoneStart;
    // Both spine clips are cut to the length of the zone they cover at
    // CRUISE_SPEED, so this lands on ~1 and only drifts while the velocity
    // ease is still settling at the very start of a leg.
    const baseRate = (speed * dur) / span;
    v.playbackRate = Math.min(MAX_RATE, Math.max(0.25, baseRate));
    const done = dur > 0 ? v.currentTime / dur : 0;
    return dir > 0 ? zoneStart + done * span : zoneEnd - done * span;
  };

  // Converts the explicit native-speed rate for the studio clip into an
  // equivalent progress/sec so it plugs into the same velocity-ease/zone
  // machinery as everything else; falls back to the flat cruise speed
  // outside that clip's zone (landing->facade clip, and hold zones, which
  // have no native-rate concept of their own).
  const desiredVelocity = (dir: number, p: number) => {
    const { b3, b4 } = BOUNDS;
    if (p >= b3 && p < b4) {
      const rate = dir > 0 ? STUDIO_ANIM_FORWARD_RATE : STUDIO_ANIM_REVERSE_RATE;
      return dir * rate * ((b4 - b3) / dur2Ref.current);
    }
    return dir * CRUISE_SPEED;
  };

  const applyProgress = (p: number, driven: Driven = null) => {
    const v1 = video1Ref.current;
    const v2 = video2Ref.current;
    const r1 = rev1Ref.current;
    const r2 = rev2Ref.current;
    if (!v1 || !v2) return;

    const { b1, b2, b3, b4 } = BOUNDS;
    const d1 = dur1Ref.current;
    const d2 = dur2Ref.current;

    // landing content
    const landingFade = 1 - clamp01(p / (b1 * 0.9 + 0.001));
    if (landingRef.current) landingRef.current.style.opacity = String(landingFade);
    if (cueRef.current) cueRef.current.style.opacity = String(landingFade);
    if (landingLogoRef.current) {
      // Denominator is b1 exactly (not b1 + slack) so the logo finishes
      // fading out right as p reaches b1 — i.e. exactly when the clip
      // itself starts moving, instead of lingering into it.
      const t = clamp01(p / b1);
      landingLogoRef.current.style.transform = `translateY(-50%) scale(${1 - t * 0.55})`;
      landingLogoRef.current.style.opacity = String(1 - t);
    }
    if (brandMarkRef.current) {
      const t = clamp01((p - b1 * 0.4) / (b1 * 0.8 + 0.02));
      brandMarkRef.current.setAttribute("data-visible", String(t > 0.5));
    }

    // clip 1 (landing -> facade)
    const driven1 = driven?.which === 1;
    if (!driven1) {
      if (p <= b1) seekVideo(v1, 0, HOLD_EPS);
      else if (p < b2) seekVideo(v1, clamp01((p - b1) / (b2 - b1)) * d1);
      else seekVideo(v1, d1, HOLD_EPS);
    }
    const show1 = p < b3 + 0.001;
    const rev1Showing = driven1 && driven!.dir < 0;
    v1.style.opacity = show1 && !rev1Showing ? "1" : "0";
    if (r1) r1.style.opacity = show1 && rev1Showing ? "1" : "0";

    // clip 2 (facade -> studio)
    const driven2 = driven?.which === 2;
    let show2 = true;
    if (!driven2) {
      if (p <= b3) {
        seekVideo(v2, 0, HOLD_EPS);
        show2 = false;
      } else if (p < b4) {
        seekVideo(v2, clamp01((p - b3) / (b4 - b3)) * d2);
      } else {
        seekVideo(v2, d2, HOLD_EPS);
      }
    }
    const rev2Showing = driven2 && driven!.dir < 0;
    v2.style.opacity = show2 && !rev2Showing ? "1" : "0";
    if (r2) r2.style.opacity = show2 && rev2Showing ? "1" : "0";

    // studio hold content
    if (studioRef.current) {
      const t = clamp01((p - b4) / 0.05);
      studioRef.current.style.opacity = String(t);
      studioRef.current.style.pointerEvents = t > 0.5 ? "auto" : "none";
    }

    // persistent footer: visible through landing + facade, fades as studio nears
    if (sceneFooterRef.current) {
      const footerOut = clamp01((p - (b4 - 0.05)) / 0.05);
      sceneFooterRef.current.style.opacity = String(1 - footerOut);
    }
  };

  // Counters aren't tied to scroll progress: they appear (and count up) only
  // once the spine actually halts on facade, and disappear the instant the
  // user starts moving away in either direction — not a function of how far
  // through the facade hold the scroll position happens to sit.
  const stopCounters = () => {
    countersActiveRef.current = false;
    if (countersRafRef.current) {
      cancelAnimationFrame(countersRafRef.current);
      countersRafRef.current = null;
    }
    if (facadeRef.current) {
      facadeRef.current.style.opacity = "0";
      facadeRef.current.style.pointerEvents = "none";
    }
    COUNTERS.forEach((c, i) => {
      const el = counterRefs.current[i];
      if (el) el.textContent = "0" + c.suffix;
    });
  };

  const startCounters = () => {
    countersActiveRef.current = true;
    if (facadeRef.current) {
      facadeRef.current.style.opacity = "1";
      facadeRef.current.style.pointerEvents = "auto";
    }
    const start = performance.now();
    const DURATION = 1400;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      COUNTERS.forEach((c, i) => {
        const el = counterRefs.current[i];
        if (el) el.textContent = fmt(c.value * eased) + c.suffix;
      });
      if (t < 1 && countersActiveRef.current) {
        countersRafRef.current = requestAnimationFrame(step);
      } else {
        countersRafRef.current = null;
      }
    };
    countersRafRef.current = requestAnimationFrame(step);
  };

  // The reversed encodes are only needed once the journey is actually moving,
  // so they stay preload="none" and start buffering once the first checkpoint
  // beyond landing is *reached*, not the moment the user departs toward it —
  // kicking off two ~15MB downloads right as a leg begins competed with that
  // same leg's own forward clip for bandwidth, which is what stalled the
  // facade -> studio clip (and, if the stall was bad enough, meant progress
  // never reached the studio checkpoint at all). Loading on arrival instead
  // gives the reverse clips the whole ensuing hold/leg to buffer in the
  // background rather than racing the video that's on screen.
  const ensureRevLoaded = () => {
    if (revLoadedRef.current) return;
    revLoadedRef.current = true;
    [rev1Ref.current, rev2Ref.current].forEach((v) => {
      if (!v) return;
      v.preload = "auto";
      v.load();
    });
  };

  // Only the landing -> facade clip has to be buffered for the page to be
  // usable, so it is the only one that fetches on first paint. The
  // facade -> studio clip is pulled in as soon as the user commits to *any*
  // move, which buys it the whole 3.4s leg plus the facade hold before it is
  // needed — on a phone that is the difference between a ~4MB first-paint
  // cost and a ~9MB one, for a clip that cannot be reached in under 4s.
  const ensureClip2Loaded = () => {
    if (clip2LoadedRef.current) return;
    clip2LoadedRef.current = true;
    const v = video2Ref.current;
    if (!v) return;
    v.preload = "auto";
    v.load();
  };

  /** Commit to travelling one checkpoint in `dir`. Returns false if there
   *  isn't one that way. */
  const beginLeg = (dir: 1 | -1) => {
    const targetIndex = checkpointIndexRef.current + dir;
    if (targetIndex < 0 || targetIndex >= SPINE_CHECKPOINTS.length) return false;
    if (SPINE_CHECKPOINTS[checkpointIndexRef.current] === "facade") stopCounters();
    ensureClip2Loaded();

    // Clear the previous leg's stills rescue before the test below reads it —
    // one stall rescues its own leg only, and this leg gets to try video
    // again. Once the watchdog has latched, this stays true and every
    // remaining leg takes the snap path.
    if (!stillsLatchedRef.current) stillsModeRef.current = false;

    // Reduced motion: honour it literally rather than playing the same
    // transition more cheaply. Snapping progress to the destination skips the
    // clip entirely — applyProgress parks both videos on the right still —
    // which is also the cheapest possible path on a struggling device.
    // A device whose media clock the watchdog has already caught dead takes
    // the same path: the clips cannot animate there, so snap and let the
    // stills carry the scene instead of freezing on a frame.
    if (reducedMotionRef.current || stillsModeRef.current) {
      const cp = SPINE_CHECKPOINTS[targetIndex];
      progressRef.current = REST_PROGRESS[cp];
      applyProgress(progressRef.current);
      syncScrollFromProgress(progressRef.current);
      settleAt(cp);
      return true;
    }

    if (dir < 0) {
      // A backward leg always starts at a checkpoint, i.e. outside both clip
      // zones, so the reversed encode always plays from its own first frame.
      [rev1Ref.current, rev2Ref.current].forEach((v) => {
        if (!v) return;
        v.pause();
        try {
          v.currentTime = 0;
        } catch {}
      });
    }
    activeClipRef.current = null;
    stallMsRef.current = 0;
    lastClipTimeRef.current = -1;
    haltedRef.current = false;
    travelDirRef.current = dir;
    return true;
  };

  /**
   * Clear WebKit's per-element autoplay restriction, from inside a real user
   * gesture — the only place it can be cleared. Every subsequent play() the
   * rAF driver issues on a primed element is then allowed, even in Low Power
   * Mode or with Safari's Auto-Play set to "Never".
   *
   * It also forces the first frame to be decoded and painted, which matters
   * independently of animation: a <video> that has never played paints
   * nothing on iOS, and the landing logo is `filter: brightness(0)` because it
   * is meant to sit on top of the bright first frame. Without this the landing
   * is black text on a black box.
   *
   * Deliberately skips anything still on preload="none". Those are the two
   * reverse encodes (~9.5 MB) which are not wanted until the user has actually
   * reached a checkpoint beyond landing; play() would start their download and
   * undo that. `ensureRevLoaded()` promotes them to preload="auto" on arrival,
   * and the user's next gesture — necessarily before any reverse leg can run —
   * primes them then.
   */
  const primeVideos = () => {
    allVideos().forEach((v) => {
      if (!v || v.preload === "none" || primedRef.current.has(v)) return;
      primedRef.current.add(v);
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          // A leg may already have started between the gesture and this
          // microtask resolving; the driver owns the element in that case and
          // pausing it here would kill the transition we just asked for.
          if (!haltedRef.current) return;
          v.pause();
          try {
            v.currentTime = 0;
          } catch {}
        }).catch(() => {});
      } else {
        try {
          v.pause();
        } catch {}
      }
    });
  };

  const settleAt = (cp: Checkpoint) => {
    haltedRef.current = true;
    travelDirRef.current = 0;
    velocityRef.current = 0;
    checkpointIndexRef.current = SPINE_CHECKPOINTS.indexOf(cp);
    activeClipRef.current = null;
    pauseAllExcept(null);
    if (cp !== "landing") ensureRevLoaded();

    const prog = programmaticRef.current;
    if (prog && cp !== prog.target) {
      // Journey-driven travel runs straight through intermediate checkpoints
      // — no halt, no counters — so landing -> studio reads as one move.
      const dir = SPINE_CHECKPOINTS.indexOf(prog.target) > checkpointIndexRef.current ? 1 : -1;
      stopCounters();
      if (beginLeg(dir)) return;
    }
    if (prog) {
      programmaticRef.current = null;
      prog.resolve();
    }
    if (cp === "facade") startCounters();
    else stopCounters();
    showStillFor(cp);
    reportSpinePosition(cp);
  };

  /**
   * Point each element at the encode this device should actually fetch.
   *
   * This has to happen here rather than in JSX because the tier depends on the
   * viewport, the pointer type and the Network Information API, none of which
   * exist during the static export — rendering a `src` on the server would
   * either hydrate-mismatch or, worse, silently commit every phone to the
   * 1080p files. The elements therefore ship with no `src` at all and get one
   * on mount; `preload="none"` elements still don't fetch anything when
   * assigned, so the staged loading strategy is unaffected.
   *
   * Declared before the duration effect so the sources are in place by the
   * time it subscribes to `loadedmetadata`.
   */
  useEffect(() => {
    const mobile = isMobileTier();
    const pairs: Array<[HTMLVideoElement | null, string]> = [
      [video1Ref.current, "/video/landing-facade.mp4"],
      [video2Ref.current, "/video/facade-studio.mp4"],
      [rev1Ref.current, REV_VIDEO_1],
      [rev2Ref.current, REV_VIDEO_2],
    ];
    pairs.forEach(([el, path]) => {
      if (el) el.src = withBasePath(tierSrc(path, mobile));
    });
  }, []);

  // `loadedmetadata` can fire before React attaches a handler, so read
  // whatever is already known on mount and only subscribe for the ones still
  // pending.
  useEffect(() => {
    const pairs: Array<[HTMLVideoElement | null, React.RefObject<number>]> = [
      [video1Ref.current, dur1Ref],
      [video2Ref.current, dur2Ref],
      [rev1Ref.current, revDur1Ref],
      [rev2Ref.current, revDur2Ref],
    ];
    const cleanups: Array<() => void> = [];
    pairs.forEach(([el, ref]) => {
      if (!el) return;
      const read = () => {
        const d = el.duration;
        if (Number.isFinite(d) && d > 0) ref.current = d;
        // Nudge the landing clip off an exact 0 so a frame is actually
        // decoded and painted. Parked at currentTime 0 and never played, this
        // element paints nothing at all on iOS — and `applyProgress` won't
        // correct it, because its rest-position seek to 0 is a no-op. The
        // landing logo is `filter: brightness(0)` on the assumption that the
        // bright first frame is behind it, so "no frame" reads as an empty
        // black page rather than as a still. Well inside HOLD_EPS, so nothing
        // downstream tries to seek it back.
        if (el === video1Ref.current && el.currentTime === 0) {
          try {
            el.currentTime = 0.001;
          } catch {}
        }
      };
      read();
      if (!Number.isFinite(el.duration) || el.duration <= 0) {
        el.addEventListener("loadedmetadata", read);
        cleanups.push(() => el.removeEventListener("loadedmetadata", read));
      }
    });
    return () => cleanups.forEach((c) => c());
  }, []);

  useEffect(() => {
    const layoutHotspots = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = Math.max(w / SOURCE_W, h / SOURCE_H);
      const dispW = SOURCE_W * scale;
      const dispH = SOURCE_H * scale;
      const offX = (w - dispW) / 2;
      const offY = (h - dispH) / 2;

      (Object.keys(HOTSPOT_BOXES) as Array<keyof typeof HOTSPOT_BOXES>).forEach((key) => {
        const box = HOTSPOT_BOXES[key];
        const el = hotspotRefs.current[key];
        if (!el) return;
        el.style.left = `${offX + box.x * scale}px`;
        el.style.top = `${offY + box.y * scale}px`;
        el.style.width = `${box.w * scale}px`;
        el.style.height = `${box.h * scale}px`;
      });
    };

    let resizeRaf: number | null = null;
    const onResize = () => {
      if (resizeRaf != null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        layoutHotspots();
      });
    };

    layoutHotspots();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    };
  }, []);

  useEffect(() => {
    // Paginated: while halted, a directional gesture commits to a transition
    // toward the adjacent checkpoint (ignored if there isn't one that way, or
    // if a transition is already in flight — no queuing, no re-steering).
    const requestTravel = (direction: 1 | -1) => {
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      if (!haltedRef.current) return;
      beginLeg(direction);
    };

    const onWheel = (e: WheelEvent) => {
      primeVideos();
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 1) return;
      requestTravel(e.deltaY > 0 ? 1 : -1);
    };

    let touchLastY = 0;
    const onTouchStart = (e: TouchEvent) => {
      // The gesture that matters. Priming has to happen here, in the touch
      // handler itself — by the time the rAF driver calls play() one frame
      // later there is no user gesture in scope any more and iOS rejects it.
      primeVideos();
      touchLastY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      const y = e.touches[0]?.clientY ?? touchLastY;
      const deltaY = touchLastY - y; // finger moves up => content scrolls down
      touchLastY = y;
      e.preventDefault();
      if (Math.abs(deltaY) < 1) return;
      requestTravel(deltaY > 0 ? 1 : -1);
    };

    const KEY_DIR: Record<string, 1 | -1> = {
      ArrowDown: 1,
      PageDown: 1,
      ArrowUp: -1,
      PageUp: -1,
    };
    const onKeyDown = (e: KeyboardEvent) => {
      primeVideos();
      const dir = KEY_DIR[e.key];
      if (dir === undefined) return;
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      e.preventDefault();
      requestTravel(dir);
    };

    const tick = (ts: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = last == null ? 0 : Math.min(0.05, (ts - last) / 1000);

      const programmatic = programmaticRef.current != null;
      if (
        (!isAnimatingRef.current || programmatic) &&
        isSpineNode(nodeRef.current) &&
        !haltedRef.current &&
        dt > 0
      ) {
        const dir = travelDirRef.current;
        const targetIndex = checkpointIndexRef.current + dir;
        const targetCp = SPINE_CHECKPOINTS[targetIndex];
        const targetP = REST_PROGRESS[targetCp];

        const p = progressRef.current;
        velocityRef.current += (desiredVelocity(dir, p) - velocityRef.current) * VELOCITY_EASE;

        const { b1, b2, b3, b4 } = BOUNDS;
        const vel = velocityRef.current;
        const speed = Math.abs(vel);
        const forward = vel > 0;
        let next: number | null = null;
        let driven: Driven = null;
        let keep: HTMLVideoElement | null = null;

        // Zone membership is tested against where this frame is *heading*,
        // not where it starts, and is half-open on the side we're travelling
        // away from. Testing the current position instead left one frame per
        // leg that had already crossed into a clip's zone without the driver
        // having claimed it, so applyProgress positioned that clip by seeking
        // — a ~1.3s decode on these 2K sources, right at the hand-off.
        const pNext = p + vel * dt;
        let justClaimed = false;
        if (speed > 0.002 && activeClipRef.current == null) {
          const inZone1 = forward ? pNext >= b1 && pNext < b2 : pNext > b1 && pNext <= b2;
          const inZone2 = forward ? pNext >= b3 && pNext < b4 : pNext > b3 && pNext <= b4;
          if (inZone1) activeClipRef.current = 1;
          else if (inZone2) activeClipRef.current = 2;
          justClaimed = activeClipRef.current != null;
        }

        const active = speed > 0.002 ? activeClipRef.current : null;
        if (active) {
          const el = active === 1
            ? forward ? video1Ref.current : rev1Ref.current
            : forward ? video2Ref.current : rev2Ref.current;
          const d = active === 1
            ? forward ? dur1Ref.current : revDur1Ref.current
            : forward ? dur2Ref.current : revDur2Ref.current;
          const [zStart, zEnd] = active === 1 ? [b1, b2] : [b3, b4];
          if (el) {
            next = driveClip(el, speed, zStart, zEnd, d, forward ? 1 : -1, justClaimed);
            if (next != null) {
              driven = { which: active, dir: forward ? 1 : -1 };
              keep = el;
              // Played out — hand the rest of the leg back to plain cruising.
              if (next === (forward ? zEnd : zStart)) activeClipRef.current = null;

              // Watchdog. driveClip derives progress from currentTime, so a
              // media clock that has stopped advancing means the spine has
              // stopped advancing — a rejected play() or a network stall both
              // land here and neither surfaces as an error. Give the element
              // STALL_LIMIT_MS to move (it legitimately reads 0 for the first
              // few frames of a leg while play() spins up), then abandon video
              // for good and finish this leg on the stills.
              const ct = el.currentTime;
              if (Math.abs(ct - lastClipTimeRef.current) < 1e-4) {
                stallMsRef.current += dt * 1000;
              } else {
                stallMsRef.current = 0;
                lastClipTimeRef.current = ct;
              }
              if (stallMsRef.current > STALL_LIMIT_MS) {
                stillsModeRef.current = true;
                stallCountRef.current += 1;
                if (stallCountRef.current >= 2) stillsLatchedRef.current = true;
                stallMsRef.current = 0;
                lastClipTimeRef.current = -1;
                activeClipRef.current = null;
                pauseAllExcept(null);
                progressRef.current = targetP;
                applyProgress(targetP);
                syncScrollFromProgress(targetP);
                settleAt(targetCp);
                rafRef.current = requestAnimationFrame(tick);
                return;
              }
            } else {
              activeClipRef.current = null;
            }
          } else {
            activeClipRef.current = null;
          }
        }
        pauseAllExcept(keep);

        if (next == null) {
          next = pNext;
        }

        const arrived = dir > 0 ? next >= targetP : next <= targetP;
        if (arrived) {
          next = targetP;
          driven = null;
          pauseAllExcept(null);
          settleAt(targetCp);
        }

        progressRef.current = next;
        applyProgress(next, driven);
        syncScrollFromProgress(next);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    applyProgress(progressRef.current);
    rafRef.current = requestAnimationFrame(tick);

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    // Taps that never become a swipe — the ribbon's "See Studio", a studio
    // hotspot — drive the spine programmatically and need the clips primed
    // just as much as a scroll gesture does.
    window.addEventListener("pointerdown", primeVideos, { passive: true });

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", primeVideos);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    registerSpine({
      // Journey-driven travel reuses the very same checkpoint machinery as a
      // scroll gesture — identical cruise/studio rates, identical native
      // playback in both directions — it just doesn't stop on the way. That
      // keeps one implementation of "move the spine" instead of a parallel
      // tween that scrubbed (and so rendered almost nothing going backwards).
      goTo: (target) =>
        new Promise<void>((resolve) => {
          const idx = SPINE_CHECKPOINTS.indexOf(target);
          if (idx < 0) {
            resolve();
            return;
          }
          if (idx === checkpointIndexRef.current && haltedRef.current) {
            progressRef.current = REST_PROGRESS[target];
            applyProgress(progressRef.current);
            syncScrollFromProgress(progressRef.current);
            resolve();
            return;
          }
          stopCounters();
          programmaticRef.current = { target, resolve };
          const dir = idx > checkpointIndexRef.current ? 1 : -1;
          if (!beginLeg(dir)) {
            programmaticRef.current = null;
            resolve();
          }
        }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jumpToStudioOption = (target: "about" | "portfolio" | "contact" | "services") => {
    if (isAnimating) return;
    goTo(target);
  };

  return (
    <div ref={scrollerRef} style={{ height: `${SPINE_VH_TOTAL}vh`, position: "relative" }}>
      <div className="brand-mark" ref={brandMarkRef} data-visible="false" data-node={node}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBasePath("/img/brand/logo.png")} alt="1920 x 1080 films" />
      </div>

      <div className="spine-pin" data-node={node}>
        {/* No `src` here on purpose — the device-appropriate encode is
            assigned on mount. See the tier effect above. */}
        <video
          ref={video1Ref}
          className="spine-video"
          muted
          playsInline
          preload="auto"
        />
        <video
          ref={video2Ref}
          className="spine-video"
          muted
          playsInline
          /* Upgraded to "auto" by ensureClip2Loaded() the moment the user
             commits to a move — see there for why it is not fetched up front. */
          preload="metadata"
        />
        <video
          ref={rev1Ref}
          className="spine-video"
          muted
          playsInline
          preload="none"
          style={{ opacity: 0 }}
        />
        <video
          ref={rev2Ref}
          className="spine-video"
          muted
          playsInline
          preload="none"
          style={{ opacity: 0 }}
        />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={stillRef} className="spine-still" alt="" aria-hidden="true" />

        <div className="landing-layer" ref={landingRef}>
          <div className="landing-logo" ref={landingLogoRef}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath("/img/brand/logo.png")} alt="1920 x 1080 films" />
          </div>
        </div>
        <div className="scroll-cue" ref={cueRef}>
          <span>Scroll to explore</span>
          <span className="line" />
        </div>

        <div className="facade-layer" ref={facadeRef}>
          <div className="eyebrow facade-eyebrow">By the numbers — since 2019</div>
          <div className="counters-grid">
            {COUNTERS.map((c, i) => (
              <div className="counter" key={c.label}>
                <div className="counter-value font-display">
                  <span ref={(el) => { counterRefs.current[i] = el; }}>0{c.suffix}</span>
                </div>
                <div className="counter-label eyebrow">{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="scene-footer" ref={sceneFooterRef}>
          <div className="scene-footer-social">
            <a href="#" onClick={(e) => e.preventDefault()}>Instagram</a>
          </div>
          <div className="scene-footer-copy">© 2026 1920 x 1080 Films. All rights reserved.</div>
        </div>

        <div className="studio-layer" ref={studioRef}>
          <div className="studio-hotspots">
            <button
              ref={(el) => { hotspotRefs.current.about = el; }}
              className="hotspot"
              onClick={() => jumpToStudioOption("about")}
            >
              <span className="hotspot-label eyebrow">About</span>
            </button>
            <button
              ref={(el) => { hotspotRefs.current.portfolio = el; }}
              className="hotspot"
              onClick={() => jumpToStudioOption("portfolio")}
            >
              <span className="hotspot-label eyebrow">Portfolio</span>
            </button>
            <button
              ref={(el) => { hotspotRefs.current.contact = el; }}
              className="hotspot"
              onClick={() => jumpToStudioOption("contact")}
            >
              <span className="hotspot-label eyebrow">Contact</span>
            </button>
            <button
              ref={(el) => { hotspotRefs.current.services = el; }}
              className="hotspot"
              onClick={() => jumpToStudioOption("services")}
            >
              <span className="hotspot-label eyebrow">Services</span>
            </button>
          </div>
          <div className="studio-caption eyebrow">Select to enter</div>

          {/* Touch fallback — CSS decides which of these two is live, so no
              client-side branching and nothing to hydrate-mismatch. */}
          <div className="studio-menu">
            {STUDIO_OPTIONS.map((key) => (
              <button
                key={key}
                className="studio-menu-item eyebrow"
                onClick={() => jumpToStudioOption(key)}
              >
                {NAV_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
