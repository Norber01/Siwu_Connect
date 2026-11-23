import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts'] } },
  './apps/web/vite.config.ts',
  {
    test: {
      name: 'rules',
      include: ['tests/rules/**/*.test.ts'],
      testTimeout: 20000,
      hookTimeout: 30000,
      fileParallelism: false,
    },
  },
  {
    test: {
      name: 'api',
      include: ['apps/api/test/**/*.test.ts'],
      testTimeout: 20000,
      hookTimeout: 30000,
      fileParallelism: false,
    },
  },
]);
