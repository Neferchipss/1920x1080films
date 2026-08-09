"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useJourney } from "@/context/JourneyContext";
import { BOUNDS, REST_PROGRESS, SPINE_VH_TOTAL, clamp01 } from "@/lib/spineLayout";
import { isSpineNode } from "@/lib/journey";
import { withBasePath } from "@/lib/basePath";

const DUR1 = 12.0;
const DUR2 = 15.0;

// Auto-scroll tuning: once engaged, the spine drifts forward on its own like
// an autoplaying video. Manual wheel/touch/keyboard input adds a decaying
// impulse on top of that baseline, so scrolling controls speed and direction
// without ever position-locking progress to raw scroll deltas (the source of
// the old scrub jank).
const BASE_SPEED = 0.03; // progress/sec drift once engaged
const MAX_SPEED = 0.5; // progress/sec clamp
const INPUT_K = 0.0022; // px of scroll/touch delta -> progress/sec impulse
const IMPULSE_DECAY_PER_SEC = 0.02; // multiplicative decay applied per second
const VELOCITY_EASE = 0.12; // per-frame ease toward target velocity

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
  const { node, registerSpine, goTo, isAnimating } = useJourney();

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
  const countersHitRef = useRef(false);
  const hotspotRefs = useRef<Partial<Record<keyof typeof HOTSPOT_BOXES, HTMLButtonElement | null>>>({});

  const progressRef = useRef(0);
  const velocityRef = useRef(0);
  const inputVelocityRef = useRef(0);
  const engagedRef = useRef(false);
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
      v1.currentTime = 0;
    } else if (p < b2) {
      const t = (p - b1) / (b2 - b1);
      v1.currentTime = clamp01(t) * DUR1;
    } else {
      v1.currentTime = DUR1;
    }
    v1Visible = p < b3 + 0.001;
    v1.style.opacity = v1Visible ? "1" : "0";

    // facade hold content
    const facadeT = clamp01((p - b2) / (b3 - b2));
    const facadeVisible = p >= b2 - 0.01 && p < b4;
    if (facadeRef.current) {
      const inT = clamp01((p - b2) / 0.03);
      const outT = clamp01((p - (b3 - 0.02)) / (b4 - (b3 - 0.02)));
      const op = facadeVisible ? Math.min(inT, 1 - outT) : 0;
      facadeRef.current.style.opacity = String(op);
      facadeRef.current.style.pointerEvents = op > 0.5 ? "auto" : "none";
    }
    if (facadeT > 0.05 && !countersHitRef.current) {
      countersHitRef.current = true;
    }
    if (countersHitRef.current) {
      const countT = clamp01((facadeT - 0.05) / 0.55);
      const eased = 1 - Math.pow(1 - countT, 3);
      COUNTERS.forEach((c, i) => {
        const el = counterRefs.current[i];
        if (el) el.textContent = fmt(c.value * eased) + c.suffix;
      });
    }

    // video2 scrub
    let v2Visible = true;
    if (p <= b3) {
      v2.currentTime = 0;
      v2Visible = false;
    } else if (p < b4) {
      const t = (p - b3) / (b4 - b3);
      v2.currentTime = clamp01(t) * DUR2;
      v2Visible = true;
    } else {
      v2.currentTime = DUR2;
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
    // Progress is no longer a direct function of scroll position (that 1:1
    // mapping is what caused the old per-scroll-event video.currentTime
    // jank). Instead a rAF loop integrates a velocity: once "engaged" by a
    // first scroll-like gesture, progress drifts forward on its own at
    // BASE_SPEED, and wheel/touch/keyboard input adds a decaying impulse on
    // top that can speed it up, slow it down, or reverse it. The real page
    // scroll position is then driven *from* progress (not the other way
    // round) purely so the browser scrollbar stays in sync.
    const addImpulse = (deltaY: number) => {
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      engagedRef.current = true;
      inputVelocityRef.current = Math.max(
        -MAX_SPEED,
        Math.min(MAX_SPEED, inputVelocityRef.current + deltaY * INPUT_K)
      );
    };

    const normalizeWheelDelta = (e: WheelEvent) => {
      if (e.deltaMode === 1) return e.deltaY * 16; // line -> px
      if (e.deltaMode === 2) return e.deltaY * window.innerHeight; // page -> px
      return e.deltaY;
    };

    const onWheel = (e: WheelEvent) => {
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      e.preventDefault();
      addImpulse(normalizeWheelDelta(e));
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
      addImpulse(deltaY);
    };

    const KEY_STEP: Record<string, number> = {
      ArrowDown: 60,
      PageDown: 400,
      ArrowUp: -60,
      PageUp: -400,
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const step = KEY_STEP[e.key];
      if (step === undefined) return;
      if (!isSpineNode(nodeRef.current) || isAnimatingRef.current) return;
      e.preventDefault();
      addImpulse(step);
    };

    const tick = (ts: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = last == null ? 0 : Math.min(0.05, (ts - last) / 1000);

      if (!isAnimatingRef.current && dt > 0) {
        inputVelocityRef.current *= Math.pow(IMPULSE_DECAY_PER_SEC, dt);

        const target = engagedRef.current
          ? Math.max(-MAX_SPEED, Math.min(MAX_SPEED, BASE_SPEED + inputVelocityRef.current))
          : 0;
        velocityRef.current += (target - velocityRef.current) * VELOCITY_EASE;

        let next = progressRef.current + velocityRef.current * dt;
        if (next <= 0) {
          next = 0;
          velocityRef.current = Math.max(velocityRef.current, 0);
        } else if (next >= 1) {
          next = 1;
          velocityRef.current = Math.min(velocityRef.current, 0);
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
        velocityRef.current = 0;
        inputVelocityRef.current = 0;
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
              progressRef.current = p;
              applyProgress(p);
              syncScrollFromProgress(p);
              engagedRef.current = true;
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
