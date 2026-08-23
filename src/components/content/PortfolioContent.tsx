"use client";

import { useState } from "react";
import { withBasePath } from "@/lib/basePath";
import { PORTFOLIO_IMAGES, type PortfolioImage } from "@/data/portfolio";
import { PORTFOLIO_FILMS } from "@/data/films";
import FilmTile from "@/components/content/FilmTile";
import Lightbox, { type LightboxItem } from "@/components/content/Lightbox";

/**
 * Both manifests are generated from the client's masters — see
 * scripts/build_portfolio_images.mjs and scripts/build_films_manifest.mjs.
 * Nothing here is hand-maintained; adding a shoot means dropping it in
 * assets/portfolio and re-running the scripts.
 */

/** Widest the grid ever renders a single tile, so the browser can pick a
 *  sensible candidate before layout is known. Tiles are at most a quarter of a
 *  1800px content column on desktop, and full-bleed on a phone. */
const SIZES = "(max-width: 700px) 92vw, (max-width: 1100px) 46vw, 24vw";

/** A plain Fisher-Yates seeded off a fixed constant (not Math.random / Date)
 *  so the build's static render and the browser's hydration pass compute the
 *  exact same order — a real shuffle would otherwise mismatch between the
 *  two and React would throw on hydration. The order only changes if the
 *  underlying manifests do (a re-run of the build scripts), which is fine:
 *  "shuffled" here means "not grouped by type," not "different every visit." */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const GALLERY: LightboxItem[] = seededShuffle(
  [
    ...PORTFOLIO_FILMS.map((film): LightboxItem => ({ type: "film", film })),
    ...PORTFOLIO_IMAGES.map((image): LightboxItem => ({ type: "photo", image })),
  ],
  1920
);

function PhotoTile({
  image,
  onOpen,
}: {
  image: PortfolioImage;
  onOpen: () => void;
}) {
  const srcset = (ext: "avif" | "webp") =>
    image.widths
      .map((w) => `${withBasePath(`/img/portfolio/${image.slug}-${w}.${ext}`)} ${w}w`)
      .join(", ");

  // Fall back to the largest WebP rather than the smallest — a browser old
  // enough to ignore <source> is rare enough that it can afford the bytes,
  // and a thumbnail stretched across a tile looks broken.
  const fallback = image.widths[image.widths.length - 1];

  return (
    <figure
      className="photo-tile"
      style={{
        aspectRatio: `${image.width} / ${image.height}`,
        // The blur holds the tile's exact shape while the real image decodes,
        // so a 114-tile grid settles once instead of reflowing all the way
        // down the page.
        backgroundImage: `url(${image.lqip})`,
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${image.title}`}
    >
      <picture>
        <source type="image/avif" srcSet={srcset("avif")} sizes={SIZES} />
        <source type="image/webp" srcSet={srcset("webp")} sizes={SIZES} />
        <img
          src={withBasePath(`/img/portfolio/${image.slug}-${fallback}.webp`)}
          alt={image.title}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
        />
      </picture>
    </figure>
  );
}

export default function PortfolioContent() {
  const [openAt, setOpenAt] = useState<number | null>(null);

  return (
    <div className="portfolio-wrap">
      {/* One mixed masonry — films and photos interleaved rather than
          sitting in separate shelves, per the shoot. */}
      <div className="portfolio-grid">
        {GALLERY.map((item, i) =>
          item.type === "film" ? (
            <FilmTile
              key={item.film.slug}
              film={item.film}
              onOpen={() => setOpenAt(i)}
            />
          ) : (
            <PhotoTile
              key={item.image.slug}
              image={item.image}
              onOpen={() => setOpenAt(i)}
            />
          )
        )}
      </div>

      {openAt !== null && (
        <Lightbox
          items={GALLERY}
          index={openAt}
          onClose={() => setOpenAt(null)}
          onNav={(delta) =>
            setOpenAt((cur) =>
              cur === null ? null : (cur + delta + GALLERY.length) % GALLERY.length
            )
          }
        />
      )}
    </div>
  );
}
