"use client";

import { useEffect, useState } from "react";
import { formatFeetInches, parseFeetInches } from "@/lib/feetInches";

// Controlled feet-inches text field — internally the app works in decimal
// feet (simpler arithmetic), this is the display/input boundary. Commits
// (and reformats to canonical "12'6"" display) on blur/Enter rather than
// every keystroke, since partial input like "12'" is invalid mid-type and
// shouldn't spam a parsed value upstream; an unparseable value on commit
// reverts to the last known-good one instead of silently zeroing it out.
export function FeetInchesInput({
  value,
  onChange,
  placeholder = `e.g. 12' 6"`,
  className = "input",
}: {
  value: number | null;
  onChange: (feet: number | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value != null ? formatFeetInches(value) : "");

  // Re-sync when the value changes externally (e.g. picking a different
  // pre-added room) — not tied to `text`, so this doesn't fight the user
  // mid-edit.
  useEffect(() => {
    setText(value != null ? formatFeetInches(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit() {
    if (!text.trim()) {
      onChange(null);
      return;
    }
    const parsed = parseFeetInches(text);
    if (parsed == null) {
      setText(value != null ? formatFeetInches(value) : "");
      return;
    }
    setText(formatFeetInches(parsed));
    onChange(parsed);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        commit();
        (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
