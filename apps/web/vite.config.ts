import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { name: 'web', environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
