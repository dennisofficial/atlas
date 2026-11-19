import type { CommandHandler } from '@dltech/atlas-commands'
import type { Db } from '@dltech/atlas-db'
import { resizeArgs } from '@dltech/atlas-native-commands'

import type { VercelConfig } from '../config/agent-host-config'
import type { SandboxProvider } from './sandbox-provider'

export type ResizeCredentialsSource = {
  read(args: { sessionId: string }): Promise<{ vercel: VercelConfig }>
}

export const REFUSAL_SANDBOX_NOT_CONFIGURED = 'The sandbox cannot be resized'

export const podResizeHandler = (args: {
  sandbox: SandboxProvider
  config: ResizeCredentialsSource
  podSessionIdOf: (params: { sessionId: string }) => Promise<string>
}): CommandHandler<unknown> => {
  return async ({ args: raw, sessionId }) => {
    const parsed = resizeArgs.safeParse(raw)
    if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
    const config = await args.config.read({ sessionId })
    if (config.vercel.configured === false) {
      return { kind: 'refused', reason: `${REFUSAL_SANDBOX_NOT_CONFIGURED}: ${config.vercel.gap}` }
    }
    const sandboxSessionId = await args.podSessionIdOf({ sessionId })
    try {
      await args.sandbox.resize({
        sandboxSessionId,
        credentials: config.vercel,
        vcpus: parsed.data.vcpus,
      })
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure)
      return { kind: 'refused', reason: `The sandbox could not be resized: ${detail}` }
    }
    return { kind: 'done' }
  }
}

export const podKeyOf = async (args: { db: Db; sessionId: string }): Promise<string> => {
  const session = await args.db.orm.v2.V2Session.first({ id: args.sessionId })
  return session?.podSessionId ?? args.sessionId
}
