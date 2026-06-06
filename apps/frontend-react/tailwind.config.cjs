/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    // MUI owns the CSS reset; Tailwind utilities compose on top.
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        bullish: '#26a69a',
        bearish: '#ef5350',
      },
    },
  },
  plugins: [],
};
