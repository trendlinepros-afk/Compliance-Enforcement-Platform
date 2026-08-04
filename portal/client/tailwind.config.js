/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Operator-tool palette: dense, dark, high-contrast.
        ink: {
          950: '#0a0e14',
          900: '#0f141b',
          850: '#141b24',
          800: '#1a222d',
          700: '#232d3a',
          600: '#31404f',
          500: '#4a5c6f',
        },
        accent: {
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
