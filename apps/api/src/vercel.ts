import 'reflect-metadata'
import { createApp } from './create-app'
import { validateEnvironment } from './api/validate-environment'
import { injectEncryptedTierEnv } from './vercel-tier-env'

injectEncryptedTierEnv()
validateEnvironment()

const app = await createApp()

export default app.getHttpAdapter().getInstance()
