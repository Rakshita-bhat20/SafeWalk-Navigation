import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

const steps = [
  {
    icon: "📍",
    title: "Drop Your Pins",
    desc: "Tap your start point and destination on the map, or type them in.",
  },
  {
    icon: "🕐",
    title: "Set Your Time",
    desc: "Tell us when you're travelling — day, evening, or night changes everything.",
  },
  {
    icon: "🤖",
    title: "AI Safety Scan",
    desc: "Our AI analyses each route and flags which roads are risky at that hour.",
  },
  {
    icon: "🟢",
    title: "Walk the Safe Path",
    desc: "Choose the green route. Avoid the red. Arrive confidently.",
  },
];

const stats = [
  { value: "3×", label: "More route options than standard maps" },
  { value: "24 / 7", label: "Works any time of day or night" },
  { value: "AI", label: "Powered safety analysis per route" },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const heroRef = useRef(null);

  // Subtle parallax on hero orbs
  useEffect(() => {
    const handleMove = (e) => {
      if (!heroRef.current) return;
      const { innerWidth: w, innerHeight: h } = window;
      const x = (e.clientX / w - 0.5) * 30;
      const y = (e.clientY / h - 0.5) * 30;
      heroRef.current.style.setProperty("--px", `${x}px`);
      heroRef.current.style.setProperty("--py", `${y}px`);
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div className="landing">
      {/* ── NAV ─────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav__logo">
          <span className="nav__logo-icon">🚶‍♀️</span>
          <span className="nav__logo-text">SafeWalk</span>
        </div>
        <button className="btn btn--outline" onClick={() => navigate("/map")}>
          Open Map →
        </button>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="hero" ref={heroRef}>
        <div className="hero__orb hero__orb--green" />
        <div className="hero__orb hero__orb--amber" />
        <div className="hero__content">
          <div className="hero__eyebrow">Women's Safety Navigation</div>
          <h1 className="hero__headline">
            Google Maps<br />
            <em>for safety,</em><br />
            not just distance.
          </h1>
          <p className="hero__sub">
            SafeWalk analyses every possible route between two points and shows
            you which roads are safe, which are risky — and which to avoid
            entirely. Because arriving fast matters less than arriving safe.
          </p>
          <div className="hero__actions">
            <button className="btn btn--primary" onClick={() => navigate("/map")}>
              Plan My Safe Route
            </button>
            <a href="#how" className="btn btn--ghost">See how it works ↓</a>
          </div>
        </div>
        <div className="hero__visual">
          <div className="hero__map-mock">
            <div className="mock-route mock-route--red" />
            <div className="mock-route mock-route--amber" />
            <div className="mock-route mock-route--green" />
            <div className="mock-pin mock-pin--start">A</div>
            <div className="mock-pin mock-pin--end">B</div>
            <div className="mock-label mock-label--safe">✓ Safe</div>
            <div className="mock-label mock-label--risk">⚠ Risky</div>
          </div>
        </div>
      </section>

      {/* ── STATS ───────────────────────────────────────────────── */}
      <section className="stats">
        {stats.map((s) => (
          <div className="stats__item" key={s.label}>
            <span className="stats__value">{s.value}</span>
            <span className="stats__label">{s.label}</span>
          </div>
        ))}
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────── */}
      <section className="steps" id="how">
        <div className="steps__header">
          <div className="section-tag">How It Works</div>
          <h2 className="section-title">Four steps to a safer walk</h2>
        </div>
        <div className="steps__grid">
          {steps.map((s, i) => (
            <div className="step-card" key={i}>
              <div className="step-card__num">0{i + 1}</div>
              <div className="step-card__icon">{s.icon}</div>
              <h3 className="step-card__title">{s.title}</h3>
              <p className="step-card__desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── COLOUR LEGEND ───────────────────────────────────────── */}
      <section className="legend-section">
        <div className="section-tag">Route Colour Key</div>
        <h2 className="section-title">Understand what each colour means</h2>
        <div className="legend-cards">
          <div className="legend-card legend-card--green">
            <span className="legend-dot" />
            <div>
              <strong>Green — Safe Route</strong>
              <p>Well-lit, populated roads. Recommended for solo travel at any hour.</p>
            </div>
          </div>
          <div className="legend-card legend-card--amber">
            <span className="legend-dot" />
            <div>
              <strong>Amber — Use Caution</strong>
              <p>Moderately safe. Fine during the day but consider alternatives at night.</p>
            </div>
          </div>
          <div className="legend-card legend-card--red">
            <span className="legend-dot" />
            <div>
              <strong>Red — Avoid</strong>
              <p>Isolated, poorly lit, or known risk areas at the selected time. Take a detour.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <section className="cta-section">
        <h2 className="cta-section__title">Ready to walk smarter?</h2>
        <p className="cta-section__sub">
          Open the planner, drop two pins, and let AI light the safer path for you.
        </p>
        <button className="btn btn--primary btn--lg" onClick={() => navigate("/map")}>
          Open Safe Route Planner →
        </button>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────── */}
      <footer className="footer">
        <span>🚶‍♀️ SafeWalk</span>
        <span>Built to keep you safe, not just fast.</span>
      </footer>
    </div>
  );
}