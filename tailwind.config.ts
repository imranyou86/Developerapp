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
    },
  },
  plugins: [],
};

export default config;
