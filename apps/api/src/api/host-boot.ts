import { AgentHostEnvError, type AgentHostEnv, readAgentHostEnv } from '@dltech/atlas-agent-host'

const EX_CONFIG = 78

const hostEnvOrExit = (): AgentHostEnv => {
  try {
    return readAgentHostEnv()
  } catch (error) {
    if (!(error instanceof AgentHostEnvError)) throw error
    console.error(error.message)
    process.exit(EX_CONFIG)
  }
}

export const assertHostBoot = async (): Promise<void> => {
  const env = hostEnvOrExit()
  if (await Bun.file(env.daemonBundlePath).exists()) return
  console.error(`api refuses to start; daemon bundle not found at ${env.daemonBundlePath}`)
  process.exit(EX_CONFIG)
}
