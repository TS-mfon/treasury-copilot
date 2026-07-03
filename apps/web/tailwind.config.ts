import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        paper: "#F8FAFC",
        mint: "#2DD4BF",
        signal: "#F59E0B",
        danger: "#DC2626",
      },
    },
  },
  plugins: [],
};

export default config;

