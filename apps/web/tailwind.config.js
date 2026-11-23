/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Provisional brand palette — final colours are a founder decision.
        brand: {
          50: '#effaf3', 100: '#d8f3e1', 200: '#b3e5c6', 300: '#80d0a3', 400: '#4bb47c',
          500: '#279860', 600: '#1a7a4c', 700: '#16623f', 800: '#14532d', 900: '#0f3d22',
        },
        gold: { 100: '#fdf3d7', 400: '#e9b949', 600: '#b7861b', 800: '#6f500c' },
        sand: { 50: '#fbfaf6', 100: '#f7f5ef', 200: '#ece8dc' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
