/** @type {import('tailwindcss').Config} */

// Every neutral + semantic color used in the UI is backed by a CSS variable so
// the whole surface flips between dark and light via [data-theme] on <html>
// (values defined in index.css). `<alpha-value>` keeps Tailwind's /opacity
// utilities working (e.g. bg-red-950/40).
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// Semantic colors: override only the shades whose role differs between themes
// (chips: 900 bg / 300 text / 800 border / 950 banner; 400 icon/status text).
// Solid shades (500/600/700 buttons) keep Tailwind defaults via extend-merge.
const semantic = (c) => ({
  300: v(`${c}-300`),
  400: v(`${c}-400`),
  800: v(`${c}-800`),
  900: v(`${c}-900`),
  950: v(`${c}-950`),
});

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          500: v('ink-500'),
          600: v('ink-600'),
          700: v('ink-700'),
          800: v('ink-800'),
          850: v('ink-850'),
          900: v('ink-900'),
          950: v('ink-950'),
        },
        slate: {
          100: v('slate-100'),
          200: v('slate-200'),
          300: v('slate-300'),
          400: v('slate-400'),
          500: v('slate-500'),
          600: v('slate-600'),
          700: v('slate-700'),
        },
        accent: {
          300: v('accent-300'),
          400: v('accent-400'),
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
        emerald: semantic('emerald'),
        amber: semantic('amber'),
        cyan: semantic('cyan'),
        fuchsia: semantic('fuchsia'),
        indigo: semantic('indigo'),
        red: semantic('red'),
        rose: semantic('rose'),
        sky: semantic('sky'),
        teal: semantic('teal'),
        violet: semantic('violet'),
        lime: { 400: v('lime-400') },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
