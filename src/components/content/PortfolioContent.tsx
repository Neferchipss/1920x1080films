import { withBasePath } from "@/lib/basePath";

const HERO = [
  { id: "frame-01", slot: "tall-left" },
  { id: "frame-02", slot: "wide-top" },
  { id: "frame-06", slot: "mid-left" },
  { id: "frame-12", slot: "mid-right" },
  { id: "frame-09", slot: "tall-right" },
] as const;

const STRIP = ["frame-05", "frame-08", "frame-11"] as const;

export default function PortfolioContent() {
  return (
    <div className="portfolio-wrap">
      <div className="portfolio-head">
        <div>
          <h1 className="font-display portfolio-title">Showcase</h1>
          <p className="portfolio-sub">
            A curated selection of photography and visual narratives captured
            across spaces and stories — placeholder imagery, final gallery to
            be curated from client masters.
          </p>
        </div>
        <button type="button" className="portfolio-filter">
          <span>All</span>
          <svg width="11" height="7" viewBox="0 0 11 7" fill="none">
            <path d="M1 1L5.5 5.5L10 1" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>

      <div className="portfolio-hero-grid">
        {HERO.map((f) => (
          <div className={`portfolio-tile portfolio-tile--${f.slot}`} key={f.id}>
            <img src={withBasePath(`/img/portfolio/${f.id}.jpg`)} alt="" loading="lazy" />
          </div>
        ))}
      </div>

      <div className="portfolio-strip-grid">
        {STRIP.map((id) => (
          <div className="portfolio-tile portfolio-tile--strip" key={id}>
            <img src={withBasePath(`/img/portfolio/${id}.jpg`)} alt="" loading="lazy" />
          </div>
        ))}
      </div>
    </div>
  );
}
