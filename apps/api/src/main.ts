import { configureSharedPool } from '@dltech/atlas-db'
import { serverAnalytics } from './agent'
import { JsonLog } from './agent/host/json-log'
import { handleTransactionTimeout } from './agent/host/transaction-timeout'
import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { assertHostBoot } from './api/host-boot'
import { validatedEnvService } from './_core/config/env/validated-env'
import { mountMacLink } from './agent/mac-link/mount'
import { createApp } from './create-app'

hydrateEnvFromTierFile()
const env = validatedEnvService()

const log = new JsonLog()
configureSharedPool({
  onTransactionTimeout: (report) =>
    handleTransactionTimeout({ report, log, errors: serverAnalytics().errors }),
})

await assertHostBoot()

const app = await createApp()
mountMacLink(app)

await app.listen(env.get('PORT'))
