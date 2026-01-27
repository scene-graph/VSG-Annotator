/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'edge-static': '#6b7280',
        'edge-dynamic': '#f97316',
        'edge-fgbg': '#a855f7',
      },
    },
  },
  plugins: [],
}
