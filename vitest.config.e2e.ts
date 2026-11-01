import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    exclude: ['**/node_modules/**', 'in-app chat resource/**'],
    // Suites share one IP and register many users; the rate-limit suite turns limits back on itself.
    // The retention timer is off; its suite calls runOnce() directly.
    env: { RATE_LIMIT_DISABLED: 'true', RETENTION_JOB_DISABLED: 'true', DB_MIGRATIONS_RUN: 'false', LOCATION_HISTORY_OPT_IN: 'true' },
    globalSetup: ['./test/setup/migrate.ts'],
  },
});
