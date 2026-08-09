"use client";

import { useEffect, useRef } from "react";
import { useJourney } from "@/context/JourneyContext";
import { BOUNDS, REST_PROGRESS, SPINE_VH_TOTAL, clamp01 } from "@/lib/spineLayout";
import { isSpineNode } from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";
import { motionCurveMultiplier } from "@/lib/motionCurve";

// Fallbacks only — the real durations are read off the elements once their
// metadata lands (see durRefs). They are NOT round numbers: facade-studio.mp4
// actually runs 15.072s, and holding the clip at a hardcoded 15.0 meant every
// arrival at studio ended with a 0.07s *backward* seek, which on a 2560x1440
// source costs ~540ms of decode — the stutter that used to hit right as the
// transition came to rest.
const DUR1_FALLBACK = 12.0;
const DUR2_FALLBACK = 15.0;

// Paginated checkpoint model: the spine holds at landing/facade/studio and
// only moves when the user picks a direction. That single gesture commits
// to an automatic play through to the adjacent checkpoint (a fixed cruise
// speed, not proportional to how hard they scrolled) which then halts
// again — further input mid-transition is ignored until it settles.
type Checkpoint = "landing" | "facade" | "studio";
const SPINE_CHECKPOINTS: Checkpoint[] = ["landing", "facade", "studio"];
const CRUISE_SPEED = 0.09; // progress/sec through the landing->facade clip and hold zones
// "Studio animations" (the facade->studio clip, EDGE_VIDEO.studio) get an
// explicit native-speed multiplier instead of the abstract cruise speed,
// same pattern as branch clips. Both directions target ~2s (15 / 7.5 = 2s),
// so forward and reverse use the same rate here rather than a reverse
// multiplier.
const STUDIO_ANIM_FORWARD_RATE = 7.5;
const STUDIO_ANIM_REVERSE_RATE = 7.5;
const VELOCITY_EASE = 0.12; // per-frame ease into CRUISE_SPEED at the start of a transition
const MAX_RATE = 8;

// Backward travel can't be done by winding `currentTime` down: a single
// backward seek on these 2560x1440/60fps sources measures ~840ms, and
// consecutive currentTime writes replace each other's pending seek, so a
// scrubbed reverse presented roughly one frame for the whole transition.
// These are the same shots pre-encoded back-to-front (at 30fps, since the
// reverse plays at several times real time) so a backward leg can run
// through the browser's normal decode pipeline exactly like a forward one.
const REV_VIDEO_1 = "/video/landing-facade-rev.mp4";
const REV_VIDEO_2 = "/video/facade-studio-rev.mp4";

/** Which clip, if any, is currently owned by native playback — applyProgress
 *  must not seek a video the playback driver is running. */
type Driven = { which: 1 | 2; dir: 1 | -1 } | null;

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
    dir: 1 | -1
  ): number | null => {
    if (speed <= 0.002) return null;
    if (v.paused) v.play().catch(() => {});
    const span = zoneEnd - zoneStart;
    const baseRate = (speed * dur) / span;
    // The curve blasts through the near-static frame each clip holds on. A
    // reversed encode carries that frame at its end, so the curve is read
    // backwards for backward legs.
    const frac = dur > 0 ? v.currentTime / dur : 0;
    const curve = motionCurveMultiplier(dir > 0 ? frac : 1 - frac);
    v.playbackRate = Math.min(MAX_RATE, Math.max(0.25, baseRate * curve));
    if (v.currentTime >= dur - 0.03) {
      v.pause();
      return dir > 0 ? zoneEnd : zoneStart;
    }
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
  // so they stay preload="none" and start buffering on the first leg rather
  // than competing with the forward clips for bandwidth on first paint.
  const ensureRevLoaded = () => {
    if (revLoadedRef.current) return;
    revLoadedRef.current = true;
    [rev1Ref.current, rev2Ref.current].forEach((v) => {
      if (!v) return;
      v.preload = "auto";
      v.load();
    });
  };

  /** Commit to travelling one checkpoint in `dir`. Returns false if there
   *  isn't one that way. */
  const beginLeg = (dir: 1 | -1) => {
    const targetIndex = checkpointIndexRef.current + dir;
    if (targetIndex < 0 || targetIndex >= SPINE_CHECKPOINTS.length) return false;
    if (SPINE_CHECKPOINTS[checkpointIndexRef.current] === "facade") stopCounters();
    ensureRevLoaded();
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
    haltedRef.current = false;
    travelDirRef.current = dir;
    return true;
  };

  const settleAt = (cp: Checkpoint) => {
    haltedRef.current = true;
    travelDirRef.current = 0;
    velocityRef.current = 0;
    checkpointIndexRef.current = SPINE_CHECKPOINTS.indexOf(cp);
    activeClipRef.current = null;
    pauseAllExcept(null);

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
    reportSpinePosition(cp);
  };

  // These elements are server-rendered with their src, so `loadedmetadata`
  // can fire before React ever attaches a handler — read whatever is already
  // known on mount and only subscribe for the ones still pending.
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
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 1) return;
      requestTravel(e.deltaY > 0 ? 1 : -1);
    };

    let touchLastY = 0;
    const onTouchStart = (e: TouchEvent) => {
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
        if (speed > 0.002 && activeClipRef.current == null) {
          const inZone1 = forward ? pNext >= b1 && pNext < b2 : pNext > b1 && pNext <= b2;
          const inZone2 = forward ? pNext >= b3 && pNext < b4 : pNext > b3 && pNext <= b4;
          if (inZone1) activeClipRef.current = 1;
          else if (inZone2) activeClipRef.current = 2;
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
            next = driveClip(el, speed, zStart, zEnd, d, forward ? 1 : -1);
            if (next != null) {
              driven = { which: active, dir: forward ? 1 : -1 };
              keep = el;
              // Played out — hand the rest of the leg back to plain cruising.
              if (next === (forward ? zEnd : zStart)) activeClipRef.current = null;
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

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
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
      <div className="brand-mark" ref={brandMarkRef} data-visible="false">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBasePath("/img/brand/logo.png")} alt="1920 x 1080 films" />
      </div>

      <div className="spine-pin" data-node={node}>
        <video
          ref={video1Ref}
          className="spine-video"
          src={withBasePath("/video/landing-facade.mp4")}
          muted
          playsInline
          preload="auto"
        />
        <video
          ref={video2Ref}
          className="spine-video"
          src={withBasePath("/video/facade-studio.mp4")}
          muted
          playsInline
          preload="auto"
        />
        <video
          ref={rev1Ref}
          className="spine-video"
          src={withBasePath(REV_VIDEO_1)}
          muted
          playsInline
          preload="none"
          style={{ opacity: 0 }}
        />
        <video
          ref={rev2Ref}
          className="spine-video"
          src={withBasePath(REV_VIDEO_2)}
          muted
          playsInline
          preload="none"
          style={{ opacity: 0 }}
        />

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
        </div>
      </div>
    </div>
  );
}
