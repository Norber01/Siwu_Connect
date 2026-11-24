/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Siwu Connect brand (founder's second mockup, 2026-11-24): deep teal-navy with gold highlights on a
        // soft sky background. The logo keeps its original green, yellow and dark figures.
        brand: {
          50: '#eef5f9', 100: '#d7e8f1', 200: '#b0d0e2', 300: '#80b2cc', 400: '#4f91b3',
          500: '#2c7699', 600: '#1d6283', 700: '#174f6b', 800: '#143f56', 900: '#0f2f41',
        },
        gold: { 100: '#fbf3dc', 400: '#d6b04a', 600: '#b8922b', 800: '#5a4511' },
        sand: { 50: '#f7fafc', 100: '#eef4f8', 200: '#dde7ee' },
        sky: { 50: '#f3f8fd', 100: '#e4f0fa', 200: '#cfe3f4' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
