'use client';
export function PlaceholderPage({ label }) {
  return (
    <div className="card">
      <b>{label}</b>
      <p className="muted" style={{ marginTop: 8 }}>
        Not built yet — this was a placeholder in the original app too (see CONVERSION_BRIEF.md, Utilities section).
      </p>
    </div>
  );
}
