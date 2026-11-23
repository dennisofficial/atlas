import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { assertHostBoot } from './api/host-boot'
import { validatedEnvService } from './_core/config/env/validated-env'
import { mountMacLink } from './agent/mac-link/mount'
import { createApp } from './create-app'

hydrateEnvFromTierFile()
const env = validatedEnvService()

await assertHostBoot()

const app = await createApp()
mountMacLink(app)

await app.listen(env.get('PORT'))
