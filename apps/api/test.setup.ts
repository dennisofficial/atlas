import { beforeEach } from 'bun:test'
import { settleAllThreadChanges } from './src/api/platform/sessions/thread-changes-pending'

process.env.APP_TIER = 'local'
process.env.PORT = '3400'
process.env.DATABASE_URL = 'postgresql://atlas:atlas@localhost:5433/atlas'
process.env.SECRET_KEY = 'test-secret-key-with-at-least-32-characters'
process.env.WEB_ORIGIN = 'http://localhost:3001'
process.env.BETTER_AUTH_URL = 'http://localhost:3400'
process.env.SECRETS_ENCRYPTION_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
process.env.TRIGGER_SECRET_KEY = 'tr_dev_test-fixture-not-a-real-key'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret'
process.env.RESEND_API_KEY = 're_test_fixture_not_a_real_key'
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_fixture_not_a_real_token'
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-cloudflare-account-id'
process.env.CLOUDFLARE_ZONE_ID = 'test-cloudflare-zone-id'

beforeEach(settleAllThreadChanges)
