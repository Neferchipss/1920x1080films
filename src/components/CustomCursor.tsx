"use client";

import { useEffect, useRef } from "react";

/**
 * A REC-button cursor: black disc, white halo ring, red tally light —
 * the record indicator on a camera body. It idles with a slow tally
 * blink, locks focus and labels itself "REC" over interactive elements,
 * and fires a shutter-ring pulse on click.
 */
export default function CustomCursor() {
  const buttonRef = useRef<HTMLDivElement>(null);
  const rippleLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Coarse pointers (touch) have no cursor to replace.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const button = buttonRef.current;
    const rippleLayer = rippleLayerRef.current;
    if (!button || !rippleLayer) return;

    document.documentElement.classList.add("has-custom-cursor");

    const move = (e: PointerEvent) => {
      button.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };

    const interactiveSelector =
      'a, button, [role="button"], input, textarea, select, .cursor-hover';

    const over = (e: PointerEvent) => {
      const target = e.target as Element | null;
      button.classList.toggle("is-hovering", !!target?.closest(interactiveSelector));
    };

    const down = (e: PointerEvent) => {
      button.classList.add("is-pressing");

      const ripple = document.createElement("span");
      ripple.className = "custom-cursor-ripple";
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      ripple.addEventListener("animationend", () => ripple.remove());
      rippleLayer.appendChild(ripple);
    };
    const up = () => button.classList.remove("is-pressing");

    const hide = () => document.documentElement.classList.add("cursor-hidden");
    const show = () => document.documentElement.classList.remove("cursor-hidden");

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerover", over);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.addEventListener("mouseleave", hide);
    document.addEventListener("mouseenter", show);

    return () => {
      document.documentElement.classList.remove("has-custom-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("mouseleave", hide);
      document.removeEventListener("mouseenter", show);
    };
  }, []);

  return (
    <div className="custom-cursor" aria-hidden="true">
      <div ref={rippleLayerRef} className="custom-cursor-ripple-layer" />
      <div ref={buttonRef} className="custom-cursor-rec">
        <span className="custom-cursor-rec-pulse" />
        <span className="custom-cursor-rec-ring" />
        <span className="custom-cursor-rec-dot" />
        <span className="custom-cursor-rec-label">REC</span>
      </div>
    </div>
  );
}
