"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { withBasePath } from "@/lib/basePath";
import { isMobileTier, tierSrc } from "@/lib/videoTier";
import type { PortfolioFilm } from "@/data/films";
import type { PortfolioImage } from "@/data/portfolio";

export type LightboxItem =
  | { type: "film"; film: PortfolioFilm }
  | { type: "photo"; image: PortfolioImage };

/** Always the full-res source, no responsive srcset — this is the one place
 *  on the page where the image is meant to fill the whole screen. */
function LightboxPhoto({ image }: { image: PortfolioImage }) {
  const largest = image.widths[image.widths.length - 1];
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={withBasePath(`/img/portfolio/${image.slug}-${largest}.avif`)}
      />
      <img
        className="lightbox-media"
        src={withBasePath(`/img/portfolio/${image.slug}-${largest}.webp`)}
        alt={image.title}
      />
    </picture>
  );
}

/** The only video bytes that actually ship are the silent grid loops (see
 *  FilmTile) — the full films live on Cloudflare Stream and aren't uploaded
 *  yet (PORTFOLIO_FILMS[].streamId is empty), so the lightbox plays the same
 *  loop, just full-screen and unmuted-ready once a Stream player replaces
 *  this. */
function LightboxFilm({ film }: { film: PortfolioFilm }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const mobile = isMobileTier();
    video.src = withBasePath(tierSrc(film.loop, mobile));
    video.play().catch(() => {});
    return () => {
      video.pause();
      video.removeAttribute("src");
    };
  }, [film.loop]);

  return (
    <video
      ref={videoRef}
      className="lightbox-media"
      muted
      loop
      autoPlay
      playsInline
      controls
      poster={film.poster ? withBasePath(film.poster) : undefined}
    />
  );
}

export default function Lightbox({
  items,
  index,
  onClose,
  onNav,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onNav: (delta: number) => void;
}) {
  const item = items[index];

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNav(1);
      else if (e.key === "ArrowLeft") onNav(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNav]);

  if (!item) return null;

  // Rendered via a portal straight onto <body>: PortfolioContent sits inside
  // BranchOverlay's own stacking context (.branch-overlay is z-index 40,
  // .branch-content z-index 2), so a z-index set on this element alone was
  // capped at that ceiling no matter how high — landing underneath the
  // site-wide Ribbon nav (z-index 60). A portal escapes that entirely.
  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <button
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M1 1l16 16M17 1L1 17"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        className="lightbox-nav lightbox-prev"
        onClick={(e) => {
          e.stopPropagation();
          onNav(-1);
        }}
        aria-label="Previous"
      >
        <svg width="14" height="24" viewBox="0 0 14 24" fill="none" aria-hidden>
          <path
            d="M12 2 2 12l10 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {item.type === "film" ? (
          <LightboxFilm key={item.film.slug} film={item.film} />
        ) : (
          <LightboxPhoto key={item.image.slug} image={item.image} />
        )}
        <div className="lightbox-caption eyebrow">
          {index + 1} / {items.length}
        </div>
      </div>

      <button
        className="lightbox-nav lightbox-next"
        onClick={(e) => {
          e.stopPropagation();
          onNav(1);
        }}
        aria-label="Next"
      >
        <svg width="14" height="24" viewBox="0 0 14 24" fill="none" aria-hidden>
          <path
            d="M2 2l10 10L2 22"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>,
    document.body
  );
}
