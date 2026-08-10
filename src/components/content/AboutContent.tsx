import { withBasePath } from "@/lib/basePath";

export default function AboutContent() {
  return (
    <div className="about-wrap">
      <div className="about-frame">
        <div className="about-frame-inner">
          <div className="about-photo">
            {/* Still a placeholder. The client's 2026-08-10 delivery was 111
                interiors and 22 films — there is no portrait of Umesh in it,
                and putting one of the interiors here would be a lie about what
                the picture is. Lives under /img/brand/ rather than
                /img/portfolio/ because build_portfolio_images.mjs wipes that
                directory on every run. */}
            <img
              src={withBasePath("/img/brand/about-portrait-placeholder.jpg")}
              alt=""
            />
          </div>
          <div className="about-copy">
            <div className="about-copy-head">
              <div>
                <div className="eyebrow">About the artist</div>
                <h1 className="font-display about-name">
                  Umesh
                  <br />
                  Pednekar
                </h1>
              </div>
              <div className="about-sig font-display">Umesh Pednekar</div>
            </div>

            <div className="about-role eyebrow">Artist. Storyteller. Observer.</div>
            <p>
              My work is a reflection of how I see and feel the world around me.
              Through light, form, and texture, I explore the quiet beauty of
              spaces, moments, and emotions that often go unnoticed.
            </p>
            <p>
              I believe every detail has a story — my purpose is to reveal it,
              preserve it, and turn it into something timeless.
            </p>

            <div className="about-meta">
              <div>
                <div className="eyebrow">Inspired by</div>
                <p>Architecture. Nature. Human emotions. Stillness.</p>
              </div>
              <div>
                <div className="eyebrow">Works across</div>
                <p>Photography. Film. Design. Fine art.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
