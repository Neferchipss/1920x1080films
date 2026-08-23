"use client";

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { isMobileTier, tierSrc } from "@/lib/videoTier";
import type { PortfolioFilm } from "@/data/films";

/**
 * One film in the portfolio grid: a poster frame that becomes a silent loop
 * while it is on screen.
 *
 * The loops are deliberately not autoplaying en masse. Twenty-two of them is
 * ~13 MB and twenty-two simultaneous decoders, which is precisely the kind of
 * thing that turns a phone's media pipeline to treacle — and there is already
 * one hard-won lesson in this codebase about what happens when a decoder
 * cannot keep up (see the comments in Spine.tsx). So a tile fetches nothing
 * until it is actually in view, and hands the bytes and the decoder straight
 * back when it leaves.
 *
 * The poster sits underneath permanently rather than being swapped out, so
 * there is never a blank frame at either edge of that transition — and if the
 * video never loads at all (blocked autoplay, dead connection) the tile is
 * still a photograph rather than a black box.
 */
export default function FilmTile({
  film,
  onOpen,
}: {
  film: PortfolioFilm;
  onOpen?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;

    // Honour reduced motion literally: the poster is the whole experience.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const mobile = isMobileTier();
    const src = withBasePath(tierSrc(film.loop, mobile));

    const enter = () => {
      if (!video.src) video.src = src;
      video.play().then(() => setPlaying(true)).catch(() => {
        // Blocked autoplay (iOS Low Power Mode, Safari's Auto-Play: Never).
        // Nothing to recover — the poster is already the fallback.
        setPlaying(false);
      });
    };

    const leave = () => {
      setPlaying(false);
      video.pause();
      // Dropping the src is what actually frees the decoder and stops any
      // in-flight download; pausing alone leaves both held.
      video.removeAttribute("src");
      video.load();
    };

    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? enter() : leave()),
      // A generous threshold keeps the number of live decoders to whatever
      // genuinely fills the viewport, rather than every tile in the column.
      { threshold: 0.45 }
    );
    io.observe(root);

    return () => {
      io.disconnect();
      video.pause();
      video.removeAttribute("src");
    };
  }, [film.loop]);

  return (
    <div
      ref={rootRef}
      className="film-tile"
      style={{ aspectRatio: `${film.width} / ${film.height}` }}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      aria-label={onOpen ? `Open ${film.title}` : undefined}
    >
      {film.poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="film-tile-poster"
          src={withBasePath(film.poster)}
          alt={film.title}
          loading="lazy"
          decoding="async"
        />
      )}
      <video
        ref={videoRef}
        className="film-tile-video"
        data-playing={playing}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
      />
    </div>
  );
}
