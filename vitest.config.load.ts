import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Load tests (test/load/*.load-spec.ts): run on demand with `npm run test:load`, not in CI.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/load/**/*.load-spec.ts'],
    env: { RATE_LIMIT_DISABLED: 'true', RETENTION_JOB_DISABLED: 'true', DB_MIGRATIONS_RUN: 'false' },
    globalSetup: ['./test/setup/migrate.ts'],
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
  },
});
