import { createApp } from './create-app'
import { registerGracefulShutdown } from './api/graceful-shutdown'
import { hydrateEnvFromTierFile } from './api/hydrate-env'
import { DrainStateService } from './api/platform/health/drain-state.service'
import { validateEnvironment } from './api/validate-environment'

hydrateEnvFromTierFile()
validateEnvironment()

const app = await createApp()

registerGracefulShutdown({
  beginDrain: () => app.get(DrainStateService).beginDrain(),
  closeApp: () => app.close(),
})

await app.listen(Number(process.env.PORT ?? 3400))
