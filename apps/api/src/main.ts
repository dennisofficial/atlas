import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { assertHostBoot } from './api/host-boot'
import { validateEnvironment } from './api/validate-environment'
import { createApp } from './create-app'

hydrateEnvFromTierFile()
validateEnvironment()

await assertHostBoot()

const app = await createApp()

await app.listen(Number(process.env.PORT ?? 3400))
