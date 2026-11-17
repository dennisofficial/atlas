import { createApp } from './create-app'
import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { assertHostBoot } from './api/host-boot'
import { validateEnvironment } from './api/validate-environment'

hydrateEnvFromTierFile()
validateEnvironment()

await assertHostBoot()

const app = await createApp({ withHost: true })

await app.listen(Number(process.env.PORT ?? 3400))
