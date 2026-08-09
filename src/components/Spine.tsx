"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useJourney } from "@/context/JourneyContext";
import { BOUNDS, REST_PROGRESS, SPINE_VH_TOTAL, clamp01 } from "@/lib/spineLayout";
import { isSpineNode } from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";
import { motionCurveMultiplier } from "@/lib/motionCurve";

const DUR1 = 12.0;
const DUR2 = 15.0;

// Paginated checkpoint model: the spine holds at landing/facade/studio and
// only moves when the user picks a direction. That single gesture commits
// to an automatic play through to the adjacent checkpoint (a fixed cruise
// speed, not proportional to how hard they scrolled) which then halts
// again — further input mid-transition is ignored until it settles.
const SPINE_CHECKPOINTS: Array<"landing" | "facade" | "studio"> = ["landing", "facade", "studio"];
const CRUISE_SPEED = 0.09; // progress/sec while committed to a transition
const VELOCITY_EASE = 0.12; // per-frame ease into CRUISE_SPEED at the start of a transition

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
  // not free) when the target barely moved since the last frame.
  const seekVideo = (v: HTMLVideoElement, t: number) => {
    if (Math.abs(v.currentTime - t) > 0.004) v.currentTime = t;
  };

  // Repeatedly seeking video.currentTime (the old approach) is fundamentally
  // not smooth: every seek is a random-access decode, and doing 60 of them a
  // second reads as a slideshow rather than a video. Whenever we're moving
  // forward through an active clip, drive it with real play()/playbackRate
  // instead and let the browser's normal decode pipeline render it — the
  // same mechanism that makes any <video> look smooth. Progress is then
  // read back from currentTime rather than dictating it. Returns the new
  // progress if it drove playback, or null if the caller should fall back to
  // manual seeking (paused/idle/reverse — playbackRate can't go negative).
  const drivePlayback = (
    v: HTMLVideoElement,
    velocity: number,
    zoneStart: number,
    zoneEnd: number,
    dur: number
  ): number | null => {
    if (velocity <= 0.002) return null;
    if (v.paused) v.play().catch(() => {});
    const baseRate = (velocity * dur) / (zoneEnd - zoneStart);
    const curve = motionCurveMultiplier(dur > 0 ? v.currentTime / dur : 0);
    v.playbackRate = Math.min(10, Math.max(0.25, baseRate * curve));
    if (v.currentTime >= dur - 0.03) {
      v.pause();
      return zoneEnd;
    }
    return zoneStart + (v.currentTime / dur) * (zoneEnd - zoneStart);
  };

  const applyProgress = (p: number) => {
    const v1 = video1Ref.current;
    const v2 = video2Ref.current;
    if (!v1 || !v2) return;

    const { b1, b2, b3, b4 } = BOUNDS;

    // landing content
    const landingFade = 1 - clamp01(p / (b1 * 0.9 + 0.001));
    if (landingRef.current) landingRef.current.style.opacity = String(landingFade);
    if (cueRef.current) cueRef.current.style.opacity = String(landingFade);
    if (landingLogoRef.current) {
      const t = clamp01(p / (b1 + 0.02));
      landingLogoRef.current.style.transform = `translateY(-50%) scale(${1 - t * 0.55})`;
      landingLogoRef.current.style.opacity = String(1 - t);
    }
    if (brandMarkRef.current) {
      const t = clamp01((p - b1 * 0.4) / (b1 * 0.8 + 0.02));
      brandMarkRef.current.setAttribute("data-visible", String(t > 0.5));
    }

    // video1 scrub
    let v1Visible = true;
    if (p <= b1) {
      seekVideo(v1, 0);
    } else if (p < b2) {
      const t = (p - b1) / (b2 - b1);
      seekVideo(v1, clamp01(t) * DUR1);
    } else {
      seekVideo(v1, DUR1);
    }
    v1Visible = p < b3 + 0.001;
    v1.style.opacity = v1Visible ? "1" : "0";

    // video2 scrub
    let v2Visible = true;
    if (p <= b3) {
      seekVideo(v2, 0);
      v2Visible = false;
    } else if (p < b4) {
      const t = (p - b3) / (b4 - b3);
      seekVideo(v2, clamp01(t) * DUR2);
      v2Visible = true;
    } else {
      seekVideo(v2, DUR2);
      v2Visible = true;
    }
    v2.style.opacity = v2Visible ? "1" : "0";

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

  const settleAt = (cp: "landing" | "facade" | "studio") => {
    haltedRef.current = true;
    travelDirRef.current = 0;
    velocityRef.current = 0;
    checkpointIndexRef.current = SPINE_CHECKPOINTS.indexOf(cp);
    if (cp === "facade") startCounters();
    else stopCounters();
    reportSpinePosition(cp);
  };

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
      const targetIndex = checkpointIndexRef.current + direction;
      if (targetIndex < 0 || targetIndex >= SPINE_CHECKPOINTS.length) return;
      if (SPINE_CHECKPOINTS[checkpointIndexRef.current] === "facade") stopCounters();
      haltedRef.current = false;
      travelDirRef.current = direction;
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

      if (!isAnimatingRef.current && isSpineNode(nodeRef.current) && !haltedRef.current && dt > 0) {
        const dir = travelDirRef.current;
        const targetIndex = checkpointIndexRef.current + dir;
        const targetCp = SPINE_CHECKPOINTS[targetIndex];
        const targetP = REST_PROGRESS[targetCp];

        velocityRef.current += (dir * CRUISE_SPEED - velocityRef.current) * VELOCITY_EASE;

        const { b1, b2, b3, b4 } = BOUNDS;
        const p = progressRef.current;
        const v1 = video1Ref.current;
        const v2 = video2Ref.current;
        let next: number | null = null;

        if (v1 && p >= b1 && p < b2 && velocityRef.current > 0) {
          next = drivePlayback(v1, velocityRef.current, b1, b2, DUR1);
          if (next != null && v2 && !v2.paused) v2.pause();
        } else if (v2 && p >= b3 && p < b4 && velocityRef.current > 0) {
          next = drivePlayback(v2, velocityRef.current, b3, b4, DUR2);
          if (next != null && v1 && !v1.paused) v1.pause();
        } else {
          if (v1 && !v1.paused) v1.pause();
          if (v2 && !v2.paused) v2.pause();
        }

        if (next == null) {
          next = p + velocityRef.current * dt;
        }

        const arrived = dir > 0 ? next >= targetP : next <= targetP;
        if (arrived) {
          next = targetP;
          if (v1 && !v1.paused) v1.pause();
          if (v2 && !v2.paused) v2.pause();
          settleAt(targetCp);
        }

        progressRef.current = next;
        applyProgress(next);
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
      goTo: async (target) => {
        const p = REST_PROGRESS[target];
        // isAnimating (set by JourneyContext before this runs) already keeps
        // the checkpoint tick's own active block from touching progress
        // while this tween drives it directly.
        velocityRef.current = 0;
        stopCounters();
        if (video1Ref.current && !video1Ref.current.paused) video1Ref.current.pause();
        if (video2Ref.current && !video2Ref.current.paused) video2Ref.current.pause();
        const obj = { p: progressRef.current };

        await new Promise<void>((resolve) => {
          gsap.to(obj, {
            p,
            duration: 1.5,
            ease: "power2.inOut",
            onUpdate: () => {
              progressRef.current = obj.p;
              applyProgress(obj.p);
              syncScrollFromProgress(obj.p);
            },
            onComplete: () => {
              settleAt(target);
              resolve();
            },
          });
        });
      },
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
