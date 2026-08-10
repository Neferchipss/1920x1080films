"use client";

import { useEffect, useRef } from "react";

/**
 * A camera AF-point cursor: a small red dot in a thin ring, like the focus
 * indicator in a viewfinder. Positioned by directly mutating the node's
 * transform on every pointermove rather than through React state, so it
 * tracks the pointer with zero re-render lag.
 */
export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Coarse pointers (touch) have no cursor to replace.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    document.documentElement.classList.add("has-custom-cursor");

    const move = (e: PointerEvent) => {
      dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      ring.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };

    const interactiveSelector =
      'a, button, [role="button"], input, textarea, select, .cursor-hover';

    const over = (e: PointerEvent) => {
      const target = e.target as Element | null;
      ring.classList.toggle("is-hovering", !!target?.closest(interactiveSelector));
    };

    const down = () => ring.classList.add("is-pressing");
    const up = () => ring.classList.remove("is-pressing");

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
      <div ref={ringRef} className="custom-cursor-ring">
        <span className="custom-cursor-tick custom-cursor-tick--n" />
        <span className="custom-cursor-tick custom-cursor-tick--e" />
        <span className="custom-cursor-tick custom-cursor-tick--s" />
        <span className="custom-cursor-tick custom-cursor-tick--w" />
      </div>
      <div ref={dotRef} className="custom-cursor-dot" />
    </div>
  );
}
