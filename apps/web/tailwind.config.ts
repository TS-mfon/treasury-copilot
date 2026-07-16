import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f5f5f5",
        paper: "#000000",
        surface: {
          low: "#0a0a0a",
          high: "#1a1a1a",
        },
        outline: "#262626",
        purple: "#a78bfa",
        success: "#4ade80",
        signal: "#fbbf24",
        danger: "#f87171",
      },
    },
  },
  plugins: [],
};

export default config;
