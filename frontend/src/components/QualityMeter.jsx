import { qualityVerdict } from "../lib/print.js";

export default function QualityMeter({ density, ai = false }) {
  const verdict = qualityVerdict(density);
  if (!verdict) return null;
  return (
    <div className="meter" data-level={verdict.id}>
      <div className="meter-bar" role="img" aria-label={`Print quality ${verdict.step} of ${verdict.steps}: ${verdict.label}`}>
        {Array.from({ length: verdict.steps }, (_, i) => (
          <span key={i} className={i < verdict.step ? "on" : ""} />
        ))}
      </div>
      <div className="meter-text">
        <strong>
          {verdict.label}
          <small>{Math.round(density)} pixels per inch from your original</small>
        </strong>
        <span>{verdict.note}</span>
        {ai && <span>AI adds plausible detail, so judge the result by eye.</span>}
      </div>
    </div>
  );
}
