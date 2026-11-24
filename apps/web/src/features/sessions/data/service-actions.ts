import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

export const SERVICE_COMMAND = 'service'

export type ServiceActionApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export type ServiceVerb = 'stop' | 'restart'

const post = async (args: {
  api: ServiceActionApi
  sessionId: string
  verb: ServiceVerb
  serviceId: string
}): Promise<void> => {
  await args.api.command({
    sessionId: args.sessionId,
    name: SERVICE_COMMAND,
    args: { action: args.verb, serviceId: args.serviceId },
  })
}

export const stopService = (args: {
  api: ServiceActionApi
  sessionId: string
  serviceId: string
}): Promise<void> => post({ ...args, verb: 'stop' })

export const restartService = (args: {
  api: ServiceActionApi
  sessionId: string
  serviceId: string
}): Promise<void> => post({ ...args, verb: 'restart' })
