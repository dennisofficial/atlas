import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { assertHostBoot } from './api/host-boot'
import { validateEnvironment } from './api/validate-environment'
import { mountMacLink } from './agent/mac-link/mount'
import { createApp } from './create-app'

hydrateEnvFromTierFile()
validateEnvironment()

await assertHostBoot()

const app = await createApp()
mountMacLink(app)

await app.listen(Number(process.env.PORT ?? 3400))
