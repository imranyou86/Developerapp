import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blueprint: {
          DEFAULT: "#1F3A5F",
          light: "#2E5182",
          dark: "#152943",
        },
        concrete: {
          DEFAULT: "#EEEAE2",
          dark: "#E2DCCF",
        },
        amber: {
          DEFAULT: "#C9822B",
          light: "#DDA05C",
          dark: "#A8691D",
        },
        sage: {
          DEFAULT: "#7A9471",
          light: "#93AC8B",
          dark: "#5E7657",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(21, 41, 67, 0.04), 0 4px 16px -4px rgba(21, 41, 67, 0.08)",
        elevated: "0 8px 30px -8px rgba(21, 41, 67, 0.22)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "fade-in-up": "fade-in-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
