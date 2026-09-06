import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        workday: {
          blue: "#0051C7",
          "blue-hover": "#0040A1",
          navy: "#0E2442",
          surface: "#F7F9FC",
          card: "#FFFFFF",
          border: "#E2E8F0",
          text: "#1A202C",
          muted: "#64748B",
          accent: "#F0F5FF",
          success: "#0D824D",
          warning: "#B45309",
          danger: "#DC2626",
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)",
        enterprise: "0 4px 6px -1px rgba(14, 36, 66, 0.06), 0 2px 4px -2px rgba(14, 36, 66, 0.04)",
        "enterprise-lg": "0 10px 15px -3px rgba(14, 36, 66, 0.08), 0 4px 6px -4px rgba(14, 36, 66, 0.04)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
