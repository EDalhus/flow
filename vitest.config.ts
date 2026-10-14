import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Testene kjører uten Access; brukeren velges med X-Dev-User.
            DEV_USER_EMAIL: 'jonas@flow.example',
            ACCESS_AUD: '',
            ADMIN_EMAILS: 'sjef@flow.example',
          },
        },
      }),
    ],
    test: {
      include: ['worker/test/**/*.test.ts'],
      setupFiles: ['./worker/test/setup.ts'],
      // Workers-runtimen får ikke lest Vitests modulcache på disk.
      fsModuleCache: false,
    },
  };
});
