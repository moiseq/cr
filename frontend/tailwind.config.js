/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        buy: "#22c55e",
        sell: "#ef4444",
        strong: "#f59e0b",
        weak: "#94a3b8",
        surface: "#0f172a",
        card: "#1e293b",
        border: "#334155",
      },
    },
  },
  plugins: [],
};
