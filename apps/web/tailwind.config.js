/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Siwu Connect brand: green, white and yellow (from the founder's design, 2026-11-23).
        brand: {
          50: '#eef8f0', 100: '#d6efdb', 200: '#ade0b8', 300: '#7dcb8e', 400: '#4caf62',
          500: '#2a9645', 600: '#1f8a3a', 700: '#187530', 800: '#135f27', 900: '#0d4a1e',
        },
        gold: { 100: '#fff7d1', 400: '#f7c600', 600: '#d9ad00', 800: '#5c4800' },
        sand: { 50: '#fafbfa', 100: '#f3f6f3', 200: '#e3e9e3' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
