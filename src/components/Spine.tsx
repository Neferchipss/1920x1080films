"use client";

import { useEffect, useRef } from "react";
import { useJourney } from "@/context/JourneyContext";
import { BOUNDS, REST_PROGRESS, SPINE_VH_TOTAL, clamp01 } from "@/lib/spineLayout";
import { NAV_LABEL, isSpineNode } from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";
import { isMobileTier, tierSrc } from "@/lib/videoTier";

// Fallbacks only — the real durations are read off the elements once their
// metadata lands (see durRefs).
const DUR1_FALLBACK = 3.45;
const DUR2_FALLBACK = 1.9833;

// Manual scrub: landing -> facade -> studio is one continuous 0..1 progress
// value read straight off the real page scroll position (see
// `scrollerRef`'s SPINE_VH_TOTAL-tall driver below) — no committed
// auto-travel, no cruise speed, no halting. `applyProgress` just renders
// whatever `p` the scrollbar says right now, the same function whether that
// `p` came from the user's own scrolling or from a programmatic nav tween
// (see `animateProgressTo`). Studio's branches (about/portfolio/contact/
// services) are unrelated to this file and keep their own click-driven
// BranchOverlay transitions.
type Checkpoint = "landing" | "facade" | "studio";
const SPINE_CHECKPOINTS: Checkpoint[] = ["landing", "facade", "studio"];

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

// Source-pixel bounds measured off the 1280x720 facade still (the same
// frame the landing->facade clip holds on): the blank stretch of wall
// between the roofline and the window openings, clear of the bright sky on
// either side. On a viewport wider than the clip's own 16:9 the object-fit
// crops height rather than width, so the full source width — sky included
// — is on screen; a viewport-relative left/right margin used to size the
// counters against *that*, not against the wall, so they leaked onto the
// sky past a certain aspect ratio. Positioned at runtime the same way the
// studio hotspots are, against the video's actual displayed geometry.
const FACADE_SOURCE_W = 1280;
const FACADE_SOURCE_H = 720;
const FACADE_COUNTERS_BOX = { x: 250, y: 224, w: 820, h: 200 };
/** Below this the portrait/near-square crop shows only a thin, already
 *  wall-only vertical slice of the source (cover crops width, not height) —
 *  the desktop box math would place the counters off-screen, so this width
 *  falls back to the plain viewport-relative CSS instead. */
const FACADE_BOX_MIN_VW = 900;

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
  /** Which checkpoint `p` currently reads closest to — drives node sync,
   *  the reduced-motion still, and nothing else (rendering itself is a pure
   *  function of `p`, not of this). */
  const checkpointRef = useRef<Checkpoint>("landing");
  const wasInFacadeHoldRef = useRef(false);
  const countersRafRef = useRef<number | null>(null);
  const countersActiveRef = useRef(false);
  const nodeRef = useRef(node);
  const isAnimatingRef = useRef(isAnimating);

  /** A programmatic (nav-driven) progress tween in flight — see
   *  `animateProgressTo`. While set, scroll-driven updates stand down so the
   *  two can't fight over `progressRef`. */
  const tweenRef = useRef<{ raf: number; resolve: () => void } | null>(null);

  /** Offscreen scratch canvas the ribbon-contrast sampler draws into — built
   *  lazily on first use rather than on mount, since most sessions never
   *  scroll fast enough to need more than a few samples a second. */
  const brightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastBrightSampleRef = useRef(0);
  const ribbonOnLightRef = useRef(false);

  const dur1Ref = useRef(DUR1_FALLBACK);
  const dur2Ref = useRef(DUR2_FALLBACK);
  const clip2LoadedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  /** Elements that have had play() called on them inside a real user
   *  gesture. WebKit's autoplay restriction is per element, and a <video>
   *  that has never played paints nothing on iOS — this is what makes the
   *  very first scrub actually show a frame there. */
  const primedRef = useRef<WeakSet<HTMLVideoElement>>(new WeakSet());

  useEffect(() => {
    nodeRef.current = node;
    isAnimatingRef.current = isAnimating;
  }, [node, isAnimating]);

  const showStillFor = (cp: Checkpoint) => {
    const el = stillRef.current;
    if (!el) return;
    if (!reducedMotionRef.current) {
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
      showStillFor(checkpointRef.current);
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

  // Only used by the programmatic nav tween, to keep the real scrollbar in
  // step with a `p` it's driving synthetically. Manual scrolling never calls
  // this — there `p` is derived *from* scrollY, so writing it back would be
  // circular.
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

  /**
   * Reads the actual pixels currently on screen under the ribbon and flags
   * whether they're light or dark, so the CSS in globals.css can swap the
   * nav to dark-on-light instead of guessing from scroll position. Scroll
   * position can't drive this directly: the hero is one continuous shot
   * sweeping from a pale sky to a near-black facade, so "how far through
   * the clip" and "how bright the strip under the header is" are only
   * loosely related and drift apart the moment the footage, crop, or
   * transition timing changes.
   *
   * Downsamples the visible frame into a tiny offscreen canvas — cheap
   * enough to run every ~150ms without competing with the clip's own
   * decode — and averages the luminance of just its top slice, which is
   * roughly what sits behind the ribbon.
   */
  const sampleRibbonContrast = (ts: number) => {
    if (ts - lastBrightSampleRef.current < 150) return;
    lastBrightSampleRef.current = ts;

    const still = stillRef.current;
    const opacityOf = (el: HTMLElement | null) => (el ? Number(el.style.opacity || "0") : 0);
    const candidates: Array<HTMLVideoElement | HTMLImageElement | null> = [
      still && opacityOf(still) > 0.5 ? still : null,
      video2Ref.current && opacityOf(video2Ref.current) > 0.5 ? video2Ref.current : null,
      video1Ref.current && opacityOf(video1Ref.current) > 0.5 ? video1Ref.current : null,
    ];
    const source = candidates.find((c) => c != null) ?? null;
    if (!source) return;

    const isVideo = source instanceof HTMLVideoElement;
    const w = isVideo ? source.videoWidth : source.naturalWidth;
    const h = isVideo ? source.videoHeight : source.naturalHeight;
    if (!w || !h) return;

    let canvas = brightCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 18;
      brightCanvasRef.current = canvas;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    try {
      // object-fit: cover crops to the viewport's aspect ratio; the 32x18
      // canvas mirrors that ratio closely enough for an average-brightness
      // read, so a plain full-frame draw stands in for the real crop.
      ctx.drawImage(source, 0, 0, 32, 18);
      // Roughly the header's share of a typical viewport height — just the
      // top slice, not the whole frame.
      const stripRows = 3;
      const { data } = ctx.getImageData(0, 0, 32, stripRows);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      const avgLuma = sum / (data.length / 4) / 255;
      const onLight = avgLuma > 0.55;
      if (onLight !== ribbonOnLightRef.current) {
        ribbonOnLightRef.current = onLight;
        document.documentElement.dataset.ribbonOnLight = String(onLight);
      }
    } catch {
      // Same-origin video/image sources never taint the canvas in practice;
      // if a future asset host ever does, just skip this sample.
    }
  };

  // Renders whatever `p` the caller hands it — the single source of truth
  // for what's on screen, whether `p` came from the real scrollbar or from
  // a programmatic tween. No easing, no rate, no ownership state: just seek
  // both clips (and every overlay) straight to their position for this `p`.
  const applyProgress = (p: number) => {
    const v1 = video1Ref.current;
    const v2 = video2Ref.current;
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
    // No fade curve of its own — visible exactly whenever the landing frame
    // isn't what's on screen, which the CSS crossfades on its own terms.
    if (brandMarkRef.current) {
      brandMarkRef.current.setAttribute("data-visible", String(p > 0));
    }

    // Fetch the facade->studio clip once the scrub is far enough into the
    // first that it'll plausibly be needed soon — no more "commit to a
    // leg" moment to hang this off, so it's a plain progress threshold.
    if (!clip2LoadedRef.current && p > b1 * 0.5) {
      clip2LoadedRef.current = true;
      const v = video2Ref.current;
      if (v) {
        v.preload = "auto";
        v.load();
      }
    }

    // clip 1 (landing -> facade)
    if (p <= b1) seekVideo(v1, 0, HOLD_EPS);
    else if (p < b2) seekVideo(v1, clamp01((p - b1) / (b2 - b1)) * d1);
    else seekVideo(v1, d1, HOLD_EPS);
    v1.style.opacity = p < b3 + 0.001 ? "1" : "0";

    // clip 2 (facade -> studio)
    if (p <= b3) {
      seekVideo(v2, 0, HOLD_EPS);
      v2.style.opacity = "0";
    } else if (p < b4) {
      seekVideo(v2, clamp01((p - b3) / (b4 - b3)) * d2);
      v2.style.opacity = "1";
    } else {
      seekVideo(v2, d2, HOLD_EPS);
      v2.style.opacity = "1";
    }

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

  // Counters aren't a function of exactly how far through the facade hold
  // the scroll position sits — they simply come in the instant the scrub
  // enters that hold (both clips parked, nothing moving) and go the instant
  // it leaves either direction.
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

  /** Which checkpoint `p` currently reads closest to. */
  const nearestCheckpoint = (p: number): Checkpoint => {
    let best: Checkpoint = "landing";
    let bestDist = Infinity;
    for (const cp of SPINE_CHECKPOINTS) {
      const d = Math.abs(p - REST_PROGRESS[cp]);
      if (d < bestDist) {
        bestDist = d;
        best = cp;
      }
    }
    return best;
  };

  // Everything downstream of `p` that isn't rendering: the counters'
  // hold-only reveal and syncing `node` for the ribbon/back button. Called
  // after every `applyProgress`, from either source of `p`.
  const updateOverlaysForProgress = (p: number) => {
    const { b2, b3 } = BOUNDS;
    const inFacadeHold = p >= b2 && p < b3;
    if (inFacadeHold !== wasInFacadeHoldRef.current) {
      wasInFacadeHoldRef.current = inFacadeHold;
      if (inFacadeHold) startCounters();
      else stopCounters();
    }

    const zone = nearestCheckpoint(p);
    if (zone !== checkpointRef.current) {
      checkpointRef.current = zone;
      showStillFor(zone);
      reportSpinePosition(zone);
    }
  };

  /**
   * Clear WebKit's per-element autoplay restriction, from inside a real user
   * gesture — the only place it can be cleared. Every subsequent seek is
   * then allowed to actually paint, even in Low Power Mode or with Safari's
   * Auto-Play set to "Never".
   */
  const primeVideos = () => {
    [video1Ref.current, video2Ref.current].forEach((v) => {
      if (!v || primedRef.current.has(v)) return;
      primedRef.current.add(v);
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.then(() => v.pause()).catch(() => {});
      } else {
        try {
          v.pause();
        } catch {}
      }
    });
  };

  const cancelTween = () => {
    if (tweenRef.current) {
      cancelAnimationFrame(tweenRef.current.raf);
      tweenRef.current = null;
    }
  };

  /**
   * Nav-driven travel (a ribbon link, a studio hotspot, "back"): tweens `p`
   * linearly from wherever it is straight to the target, one continuous
   * move with no stop at whatever checkpoint happens to sit in between —
   * landing -> studio reads the same as landing -> facade, just longer.
   * Constant rate, no ease-in/out curve.
   */
  const animateProgressTo = (targetP: number): Promise<void> => {
    cancelTween();
    return new Promise((resolve) => {
      const startP = progressRef.current;
      const distance = Math.abs(targetP - startP);
      const commit = (p: number) => {
        progressRef.current = p;
        applyProgress(p);
        syncScrollFromProgress(p);
        updateOverlaysForProgress(p);
      };
      if (distance < 0.0005) {
        commit(targetP);
        resolve();
        return;
      }
      const DURATION_MS = Math.max(500, Math.min(1800, distance * 2200));
      const start = performance.now();
      const step = (now: number) => {
        const t = clamp01((now - start) / DURATION_MS);
        commit(startP + (targetP - startP) * t);
        if (t < 1) {
          tweenRef.current = { raf: requestAnimationFrame(step), resolve };
        } else {
          tweenRef.current = null;
          resolve();
        }
      };
      tweenRef.current = { raf: requestAnimationFrame(step), resolve };
    });
  };

  /**
   * Point each element at the encode this device should actually fetch.
   *
   * This has to happen here rather than in JSX because the tier depends on the
   * viewport, the pointer type and the Network Information API, none of which
   * exist during the static export — rendering a `src` on the server would
   * either hydrate-mismatch or, worse, silently commit every phone to the
   * 1080p files. The elements therefore ship with no `src` at all and get one
   * on mount.
   *
   * Declared before the duration effect so the sources are in place by the
   * time it subscribes to `loadedmetadata`.
   */
  useEffect(() => {
    const mobile = isMobileTier();
    const pairs: Array<[HTMLVideoElement | null, string]> = [
      [video1Ref.current, "/video/landing-facade.mp4"],
      [video2Ref.current, "/video/facade-studio.mp4"],
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

    const layoutFacadeCounters = () => {
      const el = facadeRef.current;
      if (!el) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w < FACADE_BOX_MIN_VW) {
        // Narrow/portrait: cover crops width instead of height, so the
        // visible slice is already wall-only (and narrower than the box
        // below would be) — let the viewport-relative CSS handle it.
        el.style.left = "";
        el.style.top = "";
        el.style.width = "";
        el.style.height = "";
        return;
      }
      const scale = Math.max(w / FACADE_SOURCE_W, h / FACADE_SOURCE_H);
      const offX = (w - FACADE_SOURCE_W * scale) / 2;
      const offY = (h - FACADE_SOURCE_H * scale) / 2;
      // The box is the whole blank stretch of wall, sized generously so it
      // never clips the windows below it; the counters are centered inside
      // it (see .facade-layer) rather than pinned to its top-left corner,
      // so they read as sitting in the middle of that band of wall instead
      // of hugging its top edge.
      el.style.left = `${offX + FACADE_COUNTERS_BOX.x * scale}px`;
      el.style.top = `${offY + FACADE_COUNTERS_BOX.y * scale}px`;
      el.style.width = `${FACADE_COUNTERS_BOX.w * scale}px`;
      el.style.height = `${FACADE_COUNTERS_BOX.h * scale}px`;
    };

    let resizeRaf: number | null = null;
    const onResize = () => {
      if (resizeRaf != null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        layoutHotspots();
        layoutFacadeCounters();
      });
    };

    layoutHotspots();
    layoutFacadeCounters();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    };
  }, []);

  // The actual scrub: `p` is read straight off the real scrollbar position
  // within the SPINE_VH_TOTAL-tall driver, rAF-throttled so a burst of
  // native scroll events costs one seek pass per frame rather than one per
  // event. A nav tween in flight owns `progressRef` instead — see
  // `animateProgressTo` — so a manual scroll during one cancels it rather
  // than fighting it for the same value.
  useEffect(() => {
    const updateFromScroll = () => {
      const el = scrollerRef.current;
      if (!el) return;
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      if (tweenRef.current) return;
      const total = el.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const p = clamp01((window.scrollY - el.offsetTop) / total);
      progressRef.current = p;
      applyProgress(p);
      updateOverlaysForProgress(p);
    };

    let scrollRaf: number | null = null;
    const onScroll = () => {
      if (scrollRaf != null) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        updateFromScroll();
      });
    };

    // A real scroll/swipe gesture hands control back to the scrollbar —
    // priming needs the gesture too, for the same iOS reason primeVideos
    // exists at all.
    const onGesture = () => {
      primeVideos();
      cancelTween();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onGesture, { passive: true });
    window.addEventListener("touchstart", onGesture, { passive: true });
    window.addEventListener("pointerdown", primeVideos, { passive: true });

    applyProgress(progressRef.current);
    updateOverlaysForProgress(progressRef.current);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("pointerdown", primeVideos);
      if (scrollRaf != null) cancelAnimationFrame(scrollRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ribbon-contrast sampling runs on its own light-weight loop — the scrub
  // above only fires on scroll/tween activity, but the sampled frame can
  // sit still (parked at a hold) for as long as the user lingers there.
  useEffect(() => {
    let raf = requestAnimationFrame(function loop(ts) {
      sampleRibbonContrast(ts);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    registerSpine({
      goTo: (target) => animateProgressTo(REST_PROGRESS[target]),
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
          /* Upgraded to "auto" by applyProgress() once the scrub is far
             enough into clip 1 — see there for why it is not fetched up
             front. */
          preload="metadata"
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
