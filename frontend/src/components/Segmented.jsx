// A segmented control built on real radio inputs, so keyboard and
// screen-reader behaviour come from the browser instead of hand-rolled ARIA.
export default function Segmented({ name, label, value, onChange, options, disabled = false, className = "" }) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const checked = String(value) === String(option.value);
        return (
          <label key={option.value} className={`seg-item${checked ? " is-on" : ""}${disabled || option.disabled ? " is-off" : ""}`}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled || option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
            {option.hint && <small>{option.hint}</small>}
          </label>
        );
      })}
    </div>
  );
}
