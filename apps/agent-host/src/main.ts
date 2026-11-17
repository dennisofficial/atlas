import type { LogPort } from '@dltech/atlas-observability'

import { AgentHostEnvError, readAgentHostEnv } from './config/env'
import { createApp } from './create-app'
import { LOG } from './host/tokens'

const main = async (): Promise<void> => {
  const env = readAgentHostEnv()
  if (!(await Bun.file(env.daemonBundlePath).exists())) {
    console.error(`agent-host refuses to start; daemon bundle not found at ${env.daemonBundlePath}`)
    process.exit(78)
  }
  const app = await createApp(env)
  await app.listen(env.port)
  const log = app.get<LogPort>(LOG)
  log.info({ source: 'main', message: 'stream listening', data: { port: env.port } })
  log.info({ source: 'main', message: 'agent-host started' })
}

main().catch((error: unknown) => {
  if (error instanceof AgentHostEnvError) {
    console.error(error.message)
    process.exit(78)
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
