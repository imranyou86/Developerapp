"use client";

import { useEffect, useState } from "react";

type Unit = "ft" | "in";

function feetToUnit(feet: number, unit: Unit): number {
  return unit === "ft" ? feet : feet * 12;
}

function unitToFeet(n: number, unit: Unit): number {
  return unit === "ft" ? n : n / 12;
}

// Trims to 2 decimal places without leaving trailing zeros (12.50 -> "12.5",
// 12.00 -> "12").
function displayNumber(n: number): string {
  return Number(n.toFixed(2)).toString();
}

// Controlled numeric feet/inches field with a unit toggle — internally the
// app still works entirely in decimal feet (room dimensions, fixture sizes,
// sqft, prompts sent to the image model); this is the display/input
// boundary. Whichever unit is selected, `value`/`onChange` always carry
// decimal feet — switching units mid-edit converts the currently-typed
// number rather than just relabeling it, so "6" typed under "in" then
// switched to "ft" becomes "0.5", not "6".
//
// Plain digits only (no ' / " symbols to type) — easier on a phone's
// numeric keypad than the old single "12'6"" text field, which needed the
// full keyboard.
export function FeetInchesInput({
  value,
  onChange,
  label,
  className,
}: {
  value: number | null;
  onChange: (feet: number | null) => void;
  label?: string;
  className?: string;
}) {
  const [unit, setUnit] = useState<Unit>("ft");
  const [text, setText] = useState(value != null ? displayNumber(feetToUnit(value, "ft")) : "");

  // Re-sync when the value changes externally (e.g. picking a different
  // pre-added room) — not tied to `text`, so this doesn't fight the user
  // mid-edit.
  useEffect(() => {
    setText(value != null ? displayNumber(feetToUnit(value, unit)) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(raw: string) {
    if (!raw.trim()) {
      onChange(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setText(value != null ? displayNumber(feetToUnit(value, unit)) : "");
      return;
    }
    setText(displayNumber(n));
    onChange(unitToFeet(n, unit));
  }

  function switchUnit(next: Unit) {
    if (next === unit) return;
    const n = Number(text);
    const feet = text.trim() && Number.isFinite(n) ? unitToFeet(n, unit) : value;
    setUnit(next);
    setText(feet != null ? displayNumber(feetToUnit(feet, next)) : "");
  }

  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <div className="flex gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          className="input min-w-0 flex-1"
          placeholder={unit === "ft" ? "e.g. 12.5" : "e.g. 150"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit(text);
            (e.target as HTMLInputElement).blur();
          }}
        />
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-blueprint/20 text-xs font-medium">
          <button
            type="button"
            className={`px-2 transition-colors ${unit === "ft" ? "bg-blueprint text-white" : "bg-white text-blueprint/60 hover:bg-concrete"}`}
            onClick={() => switchUnit("ft")}
          >
            ft
          </button>
          <button
            type="button"
            className={`px-2 transition-colors ${unit === "in" ? "bg-blueprint text-white" : "bg-white text-blueprint/60 hover:bg-concrete"}`}
            onClick={() => switchUnit("in")}
          >
            in
          </button>
        </div>
      </div>
    </div>
  );
}
