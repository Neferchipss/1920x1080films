"use client";

import { useJourney } from "@/context/JourneyContext";

const SERVICES = [
  {
    n: "01",
    title: "Architectural Photography",
    copy: "Capturing spaces with precision, light and perspective that speak.",
  },
  {
    n: "02",
    title: "Cinematic Films",
    copy: "Story-driven films that connect, inspire and leave a lasting impact.",
  },
  {
    n: "03",
    title: "Interior Photography",
    copy: "Highlighting design, details and ambience at their best.",
  },
  {
    n: "04",
    title: "Brand & Product Photography",
    copy: "Clean, refined visuals that elevate your brand identity.",
  },
];

const PROCESS = [
  { n: "01", title: "Understand", copy: "We discuss your vision and goals." },
  { n: "02", title: "Plan", copy: "We conceptualize and plan the details." },
  { n: "03", title: "Create", copy: "We bring ideas to life with precision." },
  { n: "04", title: "Deliver", copy: "Polished visuals, on time, every time." },
];

export default function ServicesContent() {
  const { goTo } = useJourney();

  return (
    <div className="services-wrap">
      <header className="services-header">
        <div className="eyebrow">What I do</div>
        <h1 className="font-display services-title">Services</h1>
      </header>

      <div className="services-grid">
        {SERVICES.map((s) => (
          <div className="service-item" key={s.n}>
            <div className="eyebrow service-n">{s.n}</div>
            <h3 className="font-display">{s.title}</h3>
            <p>{s.copy}</p>
          </div>
        ))}
      </div>

      <div className="services-divider" />

      <section className="process-section">
        <div className="eyebrow">The process</div>
        <div className="process-row">
          {PROCESS.map((p) => (
            <div className="process-item" key={p.n}>
              <div className="eyebrow service-n">{p.n}</div>
              <div className="process-item-title font-display">{p.title}</div>
              <p>{p.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="services-divider" />

      <section className="services-cta">
        <div>
          <div className="eyebrow">Have a project in mind?</div>
          <p className="services-cta-lede">
            Let&apos;s create something timeless together.
          </p>
        </div>
        <button className="services-cta-btn" onClick={() => goTo("contact")}>
          <span>Book a Consultation</span>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden>
            <path
              d="M1 5h11.5M8 1l4.5 4L8 9"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </section>
    </div>
  );
}
