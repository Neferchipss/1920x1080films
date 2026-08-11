"use client";

import { useEffect, useRef, useState } from "react";
import { useJourney } from "@/context/JourneyContext";
import { BRANCHES, NAV_LABEL } from "@/lib/journey";

const MENU_W = 176;
const MENU_H = BRANCHES.length * 40 + 16;
const MARGIN = 8;

export default function ContextMenu() {
  const { goTo, isAnimating } = useJourney();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (e: MouseEvent) => {
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - MENU_W - MARGIN);
      const y = Math.min(e.clientY, window.innerHeight - MENU_H - MARGIN);
      setPos({ x: Math.max(MARGIN, x), y: Math.max(MARGIN, y) });
    };
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };

    window.addEventListener("contextmenu", open);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("contextmenu", open);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  if (!pos) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {BRANCHES.map((b) => (
        <button
          key={b}
          type="button"
          role="menuitem"
          className="context-menu-item"
          disabled={isAnimating}
          onClick={() => {
            setPos(null);
            goTo(b);
          }}
        >
          {NAV_LABEL[b]}
        </button>
      ))}
    </div>
  );
}
