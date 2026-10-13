import { useCallback, useRef, useState } from "react";

export default function CompareSlider({
  beforeSrc,
  afterSrc,
  ratio,
  beforeLabel = "Original",
  afterLabel = "Upscaled",
  beforeDims,
  afterDims,
  beforeStyle,
}) {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);

  const move = useCallback((clientX) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  function onKeyDown(e) {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else return;
    e.preventDefault();
  }

  // Parse labels if passed as single string "Original 1536 × 2752"
  const bLabel = beforeLabel || "Original";
  const aLabel = afterLabel || "Upscaled";
  const bFirstSpace = bLabel.indexOf(" ");
  const bTitle = beforeDims ? bLabel : (bFirstSpace > 0 ? bLabel.slice(0, bFirstSpace) : bLabel);
  const bDim = beforeDims || (bFirstSpace > 0 ? bLabel.slice(bFirstSpace + 1) : null);

  const aFirstSpace = aLabel.indexOf(" ");
  const aTitle = afterDims ? aLabel : (aFirstSpace > 0 ? aLabel.slice(0, aFirstSpace) : aLabel);
  const aDim = afterDims || (aFirstSpace > 0 ? aLabel.slice(aFirstSpace + 1) : null);

  // Fade tags when slider rule approaches them so they never collide with the knob or rule
  const leftOpacity = pos < 18 ? Math.max(0, (pos - 5) / 13) : 1;
  const rightOpacity = pos > 82 ? Math.max(0, (95 - pos) / 13) : 1;

  return (
    <div className="sheet-frame" style={{ "--ratio": ratio }}>
      <div className="fit-box">
        <div
          ref={ref}
          className="compare"
          role="slider"
          tabIndex={0}
          aria-label="Before and after comparison. Arrow keys move the divider."
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={`${Math.round(pos)}% before`}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            setDragging(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
            move(e.clientX);
          }}
          onPointerMove={(e) => dragging && move(e.clientX)}
          onPointerUp={(e) => {
            setDragging(false);
            try {
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            } catch {
              /* already released */
            }
          }}
          onPointerCancel={() => setDragging(false)}
        >
          <img className="compare-img" src={beforeSrc} alt="Original" draggable={false} style={beforeStyle} />
          <img
            className="compare-img"
            src={afterSrc}
            alt="Processed"
            draggable={false}
            style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
          />

          <div className="compare-tag left" style={{ opacity: leftOpacity }}>
            <span className="compare-tag-title">{bTitle}</span>
            {bDim && <span className="compare-tag-dim">{bDim}</span>}
          </div>

          <div className="compare-tag right" style={{ opacity: rightOpacity }}>
            <span className="compare-tag-title">{aTitle}</span>
            {aDim && <span className="compare-tag-dim">{aDim}</span>}
          </div>

          <div className="compare-rule" style={{ left: `${pos}%` }}>
            <span className="compare-knob" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

