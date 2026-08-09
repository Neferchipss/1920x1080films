"use client";

import { useEffect, useState } from "react";
import { useJourney } from "@/context/JourneyContext";
import { BRANCHES, NAV_LABEL, NodeId } from "@/lib/journey";

export default function Ribbon() {
  const { node, navOpen, setNavOpen, goTo, goBack, isAnimating } = useJourney();
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const canGoBack = node !== "landing";
  // Offered only from the landing frame: one continuous play through both
  // spine clips to the studio, skipping the facade halt. Once studio is
  // reached — by this or by scrolling — it gives way to the studio hotspots.
  const showSeeStudio = node === "landing";

  const handleNav = (target: NodeId) => {
    if (isAnimating) return;
    goTo(target);
  };

  return (
    <>
      <header className="ribbon">
        <button
          type="button"
          aria-label="Back"
          className="ribbon-icon-btn"
          data-hidden={!canGoBack}
          disabled={!canGoBack || isAnimating}
          onClick={() => goBack()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 5L8 12L15 19"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {showSeeStudio && (
          <button
            type="button"
            className="ribbon-cta"
            onClick={() => handleNav("studio")}
            disabled={isAnimating}
          >
            See Studio
          </button>
        )}

        {isDesktop ? (
          <nav className="ribbon-persistent-nav">
            {BRANCHES.map((b) => (
              <button
                key={b}
                type="button"
                className="ribbon-nav-link"
                data-active={node === b}
                onClick={() => handleNav(b)}
                disabled={isAnimating}
              >
                {NAV_LABEL[b]}
              </button>
            ))}
          </nav>
        ) : (
          <button
            type="button"
            aria-label={navOpen ? "Close menu" : "Open menu"}
            className="ribbon-icon-btn"
            data-active={navOpen}
            onClick={() => setNavOpen(!navOpen)}
          >
            <span className="hamburger" data-open={navOpen}>
              <i />
              <i />
            </span>
          </button>
        )}
      </header>

      {!isDesktop && (
        <div className="mobile-nav-overlay" data-open={navOpen}>
          <nav>
            {BRANCHES.map((b) => (
              <button
                key={b}
                type="button"
                className="mobile-nav-link"
                data-active={node === b}
                onClick={() => handleNav(b)}
              >
                {NAV_LABEL[b]}
              </button>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
