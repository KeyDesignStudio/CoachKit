import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: [
      'modules/**/tests/**/*.test.ts',
      'modules/**/tests/**/*.spec.ts',
      'tests-integration/**/*.test.ts',
      'tests-integration/**/*.spec.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
