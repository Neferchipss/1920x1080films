"use client";

import { useMemo, useState } from "react";
import { useJourney } from "@/context/JourneyContext";
import { setContactPrefill } from "@/lib/contactPrefill";

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

const CREDIT_UNITS = [
  {
    label: "1 Reel",
    credits: "8 credits",
    copy: "Short-form cinematic content for social media.",
  },
  {
    label: "1 Photo Carousel",
    credits: "7 credits",
    copy: "A curated carousel of 7 edited photographs.",
  },
  {
    label: "1 Single Photo",
    credits: "1 credit",
    copy: "One professionally edited photograph.",
  },
  {
    label: "1 Landscape Cinematic Video",
    credits: "30 credits",
    copy: "A cinematic, landscape-format film for full project showcase.",
  },
];

// Unit costs come straight from CREDIT_UNITS above — kept as a separate,
// keyed table here so the sliders can look a cost up by item without
// parsing the display strings back out of that list.
const UNIT_COST = {
  landscape: 30,
  reel: 8,
  carousel: 7,
  single: 1,
} as const;

type ItemKey = keyof typeof UNIT_COST;

const RETAINER_PLANS: {
  n: string;
  name: string;
  price: string;
  audience: string;
  credits: number;
  items: { key: ItemKey; label: string; defaultQty: number }[];
}[] = [
  {
    n: "01",
    name: "Studio",
    price: "₹50,000",
    audience: "For independent designers and growing studios.",
    credits: 100,
    items: [
      { key: "landscape", label: "Landscape Video", defaultQty: 1 },
      { key: "reel", label: "Reels", defaultQty: 4 },
      { key: "carousel", label: "Carousels (7 photos each)", defaultQty: 4 },
      { key: "single", label: "Single Photos", defaultQty: 10 },
    ],
  },
  {
    n: "02",
    name: "Signature",
    price: "₹75,000",
    audience: "For established studios with multiple active projects.",
    credits: 150,
    items: [
      { key: "landscape", label: "Landscape Videos", defaultQty: 2 },
      { key: "reel", label: "Reels", defaultQty: 6 },
      { key: "carousel", label: "Carousels (7 photos each)", defaultQty: 4 },
      { key: "single", label: "Single Photos", defaultQty: 14 },
    ],
  },
];

const TOP_UPS = [
  { credits: "25 credits (min.)", price: "₹15,000" },
  { credits: "50 credits", price: "₹28,000" },
  { credits: "100 credits", price: "₹50,000" },
];

function PlanCard({
  plan,
  onSelect,
}: {
  plan: (typeof RETAINER_PLANS)[number];
  onSelect: () => void;
}) {
  const defaults = useMemo(
    () =>
      Object.fromEntries(
        plan.items.map((item) => [item.key, item.defaultQty])
      ) as Record<ItemKey, number>,
    [plan]
  );
  const [qty, setQty] = useState<Record<ItemKey, number>>(defaults);

  const used = plan.items.reduce(
    (sum, item) => sum + qty[item.key] * UNIT_COST[item.key],
    0
  );
  const isDefault = plan.items.every((item) => qty[item.key] === defaults[item.key]);

  return (
    <div className="plan-card">
      <div className="plan-card-head">
        <div>
          <div className="eyebrow">Plan {plan.n}</div>
          <h4 className="font-display plan-name">{plan.name}</h4>
        </div>
        <div className="plan-price">
          {plan.price}
          <span>/ month</span>
        </div>
      </div>
      <p className="plan-audience">{plan.audience}</p>
      <div className="plan-credits font-display">
        {plan.credits}
        <span>credits / month</span>
      </div>

      <div className="plan-allocation">
        <div className="plan-allocation-title-row">
          <span className="eyebrow">Build your allocation</span>
          <span className="plan-used" data-full={used === plan.credits}>
            {used} / {plan.credits} credits used
          </span>
          {!isDefault && (
            <button
              type="button"
              className="plan-reset"
              onClick={() => setQty(defaults)}
            >
              Reset
            </button>
          )}
        </div>

        {plan.items.map((item) => {
          const cost = UNIT_COST[item.key];
          const usedByOthers = used - qty[item.key] * cost;
          const maxQty = Math.floor((plan.credits - usedByOthers) / cost);
          return (
            <div className="plan-slider-row" key={item.key}>
              <div className="plan-slider-label">
                <span>
                  {qty[item.key]} {item.label}
                </span>
                <span className="plan-slider-credits">
                  {qty[item.key] * cost} credits
                </span>
              </div>
              <input
                type="range"
                className="plan-slider"
                min={0}
                max={maxQty}
                value={qty[item.key]}
                onChange={(e) =>
                  setQty((prev) => ({
                    ...prev,
                    [item.key]: Number(e.target.value),
                  }))
                }
                aria-label={`${item.label} per month`}
              />
            </div>
          );
        })}
      </div>

      <button className="plan-select-btn" onClick={onSelect}>
        <span>Select Plan</span>
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
    </div>
  );
}

export default function ServicesContent() {
  const { goTo, jumpTo } = useJourney();

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

      <div className="services-divider" />

      <section className="retainer-section">
        <header className="retainer-header">
          <div className="eyebrow">Content Retainer</div>
          <h2 className="font-display retainer-title">
            Consistent visuals.
            <br />
            <em>Greater impact.</em>
          </h2>
          <p className="retainer-lede">
            A flexible subscription for interior designers, architects and
            creative studios — built for consistent, high-quality content.
          </p>
        </header>

        <div className="retainer-block">
          <div className="retainer-block-head">
            <div className="eyebrow service-n">01</div>
            <div>
              <h3 className="font-display">How credits work</h3>
              <p>
                Your subscription includes a monthly credit allocation that
                can be used across reels, carousels, single photos and
                cinematic videos.
              </p>
            </div>
          </div>
          <div className="credit-grid">
            {CREDIT_UNITS.map((c) => (
              <div className="credit-item" key={c.label}>
                <div className="credit-item-label">{c.label}</div>
                <div className="credit-item-value font-display">
                  {c.credits}
                </div>
                <p>{c.copy}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="retainer-block">
          <div className="retainer-block-head">
            <div className="eyebrow service-n">02</div>
            <div>
              <h3 className="font-display">Our plans</h3>
              <p>Choose the plan that fits your studio&apos;s needs.</p>
            </div>
          </div>
          <div className="plans-grid">
            {RETAINER_PLANS.map((plan) => (
              <PlanCard
                plan={plan}
                key={plan.n}
                onSelect={() => {
                  setContactPrefill(
                    `I'm interested in the ${plan.name} retainer plan (${plan.price}/month, ${plan.credits} credits).`
                  );
                  jumpTo("contact");
                }}
              />
            ))}
          </div>
        </div>

        <div className="retainer-block">
          <div className="retainer-block-head">
            <div className="eyebrow service-n">03</div>
            <div>
              <h3 className="font-display">Additional information</h3>
              <p>Everything you need to know about your subscription.</p>
            </div>
          </div>
          <div className="retainer-extra-grid">
            <div className="retainer-extra-item">
              <div className="eyebrow">Credit rollover</div>
              <p>
                Unused credits roll over to the next month, up to a limit.
              </p>
              <ul>
                <li>Studio Plan: max 50 credits</li>
                <li>Signature Plan: max 75 credits</li>
              </ul>
              <p className="retainer-extra-note">
                Rollover credits are valid for 2 months only.
              </p>
            </div>

            <div className="retainer-extra-item">
              <div className="eyebrow">Top up credits</div>
              <p>Need more credits? Top up anytime.</p>
              <div className="topup-table">
                {TOP_UPS.map((t) => (
                  <div className="topup-row" key={t.credits}>
                    <span>{t.credits}</span>
                    <span>{t.price}</span>
                  </div>
                ))}
              </div>
              <p className="retainer-extra-note">
                Top up credits are valid for 60 days.
              </p>
            </div>

            <div className="retainer-extra-item">
              <div className="eyebrow">RAW data</div>
              <p>
                All RAW files from the shoots are included in your
                subscription.
              </p>
              <p className="retainer-extra-note">No extra cost. No extra credits.</p>
            </div>

            <div className="retainer-extra-item">
              <div className="eyebrow">Flexible usage</div>
              <p>
                Use your credits across reels, carousels, single photos and
                landscape cinematic videos the way you need.
              </p>
              <p className="retainer-extra-note">
                Your projects. Your choice.
              </p>
            </div>
          </div>
        </div>

        <button
          className="services-cta-btn retainer-enquire"
          onClick={() => goTo("contact")}
        >
          <span>Enquire About the Retainer</span>
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
