import 'reflect-metadata'
import { sharedPool } from '@dltech/atlas-db'
import { attachDatabasePool } from '@vercel/functions'
import { createApp } from './create-app'
import { validateEnvironment } from './api/validate-environment'
import { injectEncryptedTierEnv } from './vercel-tier-env'

injectEncryptedTierEnv()
validateEnvironment()

// A suspended Fluid instance keeps its idle sockets open at PgBouncer until Vercel reclaims it;
// attaching the pool keeps the instance alive until the pool's idle timeout has closed them.
// https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool
attachDatabasePool(sharedPool())

const app = await createApp()

export default app.getHttpAdapter().getInstance()
