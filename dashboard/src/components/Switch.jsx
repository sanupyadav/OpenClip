import React from 'react';

// On/off toggle (a real checkbox underneath, so it is keyboard- and screen-reader-friendly).
export default function Switch({ checked, onChange, disabled, label }) {
  return (
    // A <label>, so a click on the drawn track reaches the hidden checkbox.
    <label className={`relative inline-flex items-center shrink-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span className="w-11 h-6 rounded-full bg-paper3 border border-rule2 peer-checked:bg-brass peer-disabled:opacity-40 transition-colors after:content-[''] after:absolute after:left-1 after:top-1 after:w-4 after:h-4 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}
