import { useRef } from "react";

const clamp = (n) => Math.min(1, Math.max(0, n));

// A to-scale picture of the sheet being printed, with the image placed on it
// the way the chosen fit mode will place it. In "fill" mode the image can be
// dragged (or moved with arrow keys) to choose what the crop keeps.
export default function SheetPreview({
  ratio,
  labelW,
  labelH,
  src,
  srcW,
  srcH,
  previewable,
  fit,
  focus,
  onFocus,
  placeholder,
}) {
  const sheetRef = useRef(null);
  const drag = useRef(null);
  const canMove = fit === "fill" && previewable && Boolean(src);

  function overflow() {
    const rect = sheetRef.current.getBoundingClientRect();
    const scale = Math.max(rect.width / srcW, rect.height / srcH);
    return { x: srcW * scale - rect.width, y: srcH * scale - rect.height };
  }

  function onPointerDown(e) {
    if (!canMove) return;
    drag.current = { x: e.clientX, y: e.clientY, start: focus };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!drag.current) return;
    const over = overflow();
    const { x, y, start } = drag.current;
    onFocus({
      x: over.x > 0.5 ? clamp(start.x - (e.clientX - x) / over.x) : start.x,
      y: over.y > 0.5 ? clamp(start.y - (e.clientY - y) / over.y) : start.y,
    });
  }

  function endDrag(e) {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
  }

  function onKeyDown(e) {
    if (!canMove) return;
    const step = e.shiftKey ? 0.15 : 0.04;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    onFocus({ x: clamp(focus.x + m[0]), y: clamp(focus.y + m[1]) });
  }

  const imgStyle = fit === "fill" ? { objectPosition: `${focus.x * 100}% ${focus.y * 100}%` } : undefined;

  return (
    <div className="sheet-frame" style={{ "--ratio": ratio }}>
      <div className="sheet-box">
        <span className="dim dim-top" aria-hidden="true">{labelW}</span>
        <span className="dim dim-left" aria-hidden="true">{labelH}</span>
        <i className="mark tl" aria-hidden="true" />
        <i className="mark tr" aria-hidden="true" />
        <i className="mark bl" aria-hidden="true" />
        <i className="mark br" aria-hidden="true" />
        <div
          ref={sheetRef}
          className={`sheet${canMove ? " is-movable" : ""}`}
          tabIndex={canMove ? 0 : undefined}
          role={canMove ? "group" : undefined}
          aria-label={canMove ? "Crop position. Drag the image or use arrow keys to choose what stays on the sheet." : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        >
          {src && previewable ? (
            <img className={`sheet-img fit-${fit}`} style={imgStyle} src={src} alt="Image placed on the sheet" draggable={false} />
          ) : (
            <div className="sheet-empty">{placeholder}</div>
          )}
        </div>
      </div>
    </div>
  );
}
