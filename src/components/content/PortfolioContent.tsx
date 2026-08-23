import { withBasePath } from "@/lib/basePath";
import { PORTFOLIO_IMAGES, type PortfolioImage } from "@/data/portfolio";
import { PORTFOLIO_FILMS } from "@/data/films";
import FilmTile from "@/components/content/FilmTile";

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

function Tile({ image }: { image: PortfolioImage }) {
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
        // so a 111-tile grid settles once instead of reflowing all the way
        // down the page.
        backgroundImage: `url(${image.lqip})`,
      }}
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
  return (
    <div className="portfolio-wrap">
      {PORTFOLIO_FILMS.length > 0 && (
        <section className="portfolio-section">
          <h2 className="portfolio-section-title eyebrow">Films</h2>

          {/* Column masonry, same technique as the photo grid below: mixing
              landscape and portrait films in one flow reads as a real reel
              rather than two segregated shelves. */}
          <div className="film-grid">
            {PORTFOLIO_FILMS.map((film) => (
              <FilmTile key={film.slug} film={film} />
            ))}
          </div>
        </section>
      )}

      <section className="portfolio-section">
        <h2 className="portfolio-section-title eyebrow">Photography</h2>
        {/* Column masonry rather than a row grid: these are 24 MP masters in
            two orientations, and cropping them to a uniform cell would be a
            strange thing to do to a photographer's portfolio. Each tile keeps
            its true aspect ratio and the columns absorb the difference. */}
        <div className="photo-masonry">
          {PORTFOLIO_IMAGES.map((image) => (
            <Tile key={image.slug} image={image} />
          ))}
        </div>
      </section>
    </div>
  );
}
