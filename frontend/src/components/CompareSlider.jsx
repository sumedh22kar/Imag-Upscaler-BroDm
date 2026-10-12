import { useCallback, useRef, useState } from "react";

export default function CompareSlider({ beforeSrc, afterSrc, ratio, beforeLabel, afterLabel, beforeStyle }) {
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
        <span className="compare-tag left">{beforeLabel}</span>
        <span className="compare-tag right">{afterLabel}</span>
        <div className="compare-rule" style={{ left: `${pos}%` }}>
          <span className="compare-knob" aria-hidden="true" />
        </div>
      </div>
      </div>
    </div>
  );
}
