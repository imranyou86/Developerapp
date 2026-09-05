import Image from "next/image";

// public/logo.png is the Alaia Homes Dev mark, trimmed to its own bounds and
// resized from the original (public/AHLOGO.png, ~11.7k x 8.4k) via sharp —
// see the note in that file's git history if it ever needs regenerating.
// It's black on transparent, so shown directly on the white header bars
// rather than inside a colored badge chip (no chip color would give it
// enough contrast without recoloring the artwork).
const ASPECT_RATIO = 336 / 240;

const SIZES = {
  sm: { height: 36, className: "h-9" },
  lg: { height: 48, className: "h-12" },
};

export function BrandMark({ size = "sm", className = "" }: { size?: "sm" | "lg"; className?: string }) {
  const { height, className: sizeClassName } = SIZES[size];
  return (
    <Image
      src="/logo.png"
      alt="Alaia Homes Dev"
      width={Math.round(height * ASPECT_RATIO)}
      height={height}
      className={`${sizeClassName} w-auto shrink-0 ${className}`}
      priority
    />
  );
}
