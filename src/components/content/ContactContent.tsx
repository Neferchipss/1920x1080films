"use client";

import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/basePath";

// Mumbai (19.076N 72.877E) as a fraction of the equirectangular source map.
const MUMBAI_X_FRAC = 0.7024;
const MUMBAI_Y_FRAC = 0.3940;

export default function ContactContent() {
  const mapImgRef = useRef<HTMLImageElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = mapImgRef.current;
    const pin = pinRef.current;
    if (!img || !pin) return;

    const place = () => {
      const container = img.parentElement;
      if (!container || !img.naturalWidth) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      // object-fit: cover geometry, same technique as the studio hotspots.
      const scale = Math.max(cw / iw, ch / ih);
      const dispW = iw * scale;
      const dispH = ih * scale;
      const offX = (cw - dispW) / 2;
      const offY = (ch - dispH) / 2;
      const x = offX + MUMBAI_X_FRAC * dispW;
      const y = offY + MUMBAI_Y_FRAC * dispH;
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
    };

    if (img.complete) place();
    img.addEventListener("load", place);
    window.addEventListener("resize", place);
    return () => {
      img.removeEventListener("load", place);
      window.removeEventListener("resize", place);
    };
  }, []);

  return (
    <div className="contact-wrap">
      <div className="contact-split">
        <div className="contact-left">
          <div className="eyebrow">Let&apos;s collaborate</div>
          <h1 className="font-display contact-title">
            Tell me about
            <br />
            your project
          </h1>
          <p className="contact-sub">
            Whether it&apos;s a photoshoot, film, or a creative collaboration,
            I&apos;d love to hear what you&apos;re working on.
          </p>

          <form className="contact-form" onSubmit={(e) => e.preventDefault()}>
            <label className="field">
              <span className="eyebrow">Your name</span>
              <input type="text" name="name" required />
            </label>
            <label className="field">
              <span className="eyebrow">Email address</span>
              <input type="email" name="email" required />
            </label>
            <label className="field">
              <span className="eyebrow">Phone number</span>
              <input type="tel" name="phone" />
            </label>
            <label className="field">
              <span className="eyebrow">Project type</span>
              <select name="projectType" defaultValue="">
                <option value="" disabled>
                  Select one
                </option>
                <option>Photo Documentation</option>
                <option>Video Documentation</option>
                <option>Photo &amp; Video</option>
                <option>Something else</option>
              </select>
            </label>
            <label className="field">
              <span className="eyebrow">Tell me about your project</span>
              <textarea name="message" rows={3} />
            </label>
            <button type="submit" className="contact-submit">
              <span>Book Now</span>
              <span aria-hidden>→</span>
            </button>
            <p className="contact-note">I&apos;ll get back to you within 24 hours.</p>
          </form>
        </div>

        <div className="contact-right">
          <img src={withBasePath("/img/brand/studio-still.jpg")} alt="" />
        </div>
      </div>

      <div className="contact-footer-bar">
        <a href="mailto:1920x1080films@gmail.com">
          <svg width="15" height="12" viewBox="0 0 15 12" fill="none" aria-hidden>
            <path
              d="M1 1h13v10H1V1Zm0 0 6.5 5L14 1"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
          1920x1080films@gmail.com
        </a>
        <a href="tel:+919101586350">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <path
              d="M2 1.5 4.5 2 5 4.5 3.5 6a8 8 0 0 0 4 4l1.5-1.5L11 9l.5 2.5-1.5 1C6 12 1 7 1 3L2 1.5Z"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>
          +91 91015 86350
        </a>
        <span>
          <svg width="11" height="14" viewBox="0 0 11 14" fill="none" aria-hidden>
            <path
              d="M5.5 13S1 8.4 1 5.2a4.5 4.5 0 0 1 9 0C10 8.4 5.5 13 5.5 13Z"
              stroke="currentColor"
              strokeWidth="1"
            />
            <circle cx="5.5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1" />
          </svg>
          Mumbai, India
        </span>
        <div className="contact-footer-social">
          <a href="#" onClick={(e) => e.preventDefault()}>
            Instagram
          </a>
        </div>
      </div>

      <div className="contact-map-section">
        <div className="contact-map-image" aria-hidden>
          <img ref={mapImgRef} src={withBasePath("/img/world-map.svg")} alt="" />
        </div>
        <div className="contact-map-pin" ref={pinRef} aria-hidden>
          <span className="contact-map-pulse" />
        </div>
        <div className="contact-map-copy">
          <div className="contact-map-label">
            <svg width="13" height="16" viewBox="0 0 11 14" fill="none" aria-hidden>
              <path
                d="M5.5 13S1 8.4 1 5.2a4.5 4.5 0 0 1 9 0C10 8.4 5.5 13 5.5 13Z"
                stroke="currentColor"
                strokeWidth="1"
              />
              <circle cx="5.5" cy="5" r="1.6" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="eyebrow">Based in Mumbai, India</span>
          </div>
          <p>Available for projects worldwide.</p>
        </div>
        <div className="contact-map-footer">
          <span>© 2026 1920 x 1080 Films. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
