import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * `npm run capture:api-responses`: regenerates API_RESPONSES.md by walking the whole API
 * against the dev database + Redis (see test/capture/api-responses.capture.ts).
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/capture/**/*.capture.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    env: { RATE_LIMIT_DISABLED: 'true', RETENTION_JOB_DISABLED: 'true', DB_MIGRATIONS_RUN: 'false' },
    globalSetup: ['./test/setup/migrate.ts'],
  },
});
