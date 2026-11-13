import { hashPassword } from 'better-auth/crypto'

import { db } from '@dltech/atlas-db'

const SEED_USER_ID = 'seed_user_dev'
const SEED_ACCOUNT_ID = 'seed_account_credential'
const DEFAULT_EMAIL = 'dev@atlas.local'
const DEFAULT_PASSWORD = 'atlas-dev-password'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

const databaseUrl = process.env.DATABASE_URL ?? ''
const host = hostOf(databaseUrl)
if (host === null) {
  console.error('DATABASE_URL is not a url; run this through `bun run dev:login`')
  process.exit(1)
}
if (!LOCAL_HOSTS.has(host)) {
  console.error(
    `refusing to set a dev password on ${host}: this only runs against a local database`,
  )
  process.exit(1)
}

const email = process.env.DEV_LOGIN_EMAIL ?? DEFAULT_EMAIL
const password = process.env.DEV_LOGIN_PASSWORD ?? DEFAULT_PASSWORD
const hashed = await hashPassword(password)

await db.orm.public.User.upsert({
  create: { id: SEED_USER_ID, name: 'Dev User', email, emailVerified: true },
  update: { email, emailVerified: true },
  conflictOn: { id: SEED_USER_ID },
})
await db.orm.public.Account.upsert({
  create: {
    id: SEED_ACCOUNT_ID,
    accountId: SEED_USER_ID,
    providerId: 'credential',
    password: hashed,
    userId: SEED_USER_ID,
  },
  update: { password: hashed },
  conflictOn: { id: SEED_ACCOUNT_ID },
})

console.log(`signed-in-as-ready: ${email} / ${password}`)
