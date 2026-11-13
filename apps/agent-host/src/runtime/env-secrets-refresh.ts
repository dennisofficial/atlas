import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { EnvSecretsSource } from '../config/env-secrets'
import { abortable } from './abortable'
import type { ShellEnvCell } from './shell-env'

export type SecretsRefresher = (signal?: AbortSignal) => Promise<void>

export const envSecretsRefresher = (args: {
  source?: EnvSecretsSource | undefined
  cell: ShellEnvCell
  userId: string
  projectId: string
  sessionId: string
  log?: LogPort | undefined
}): SecretsRefresher => {
  const { source } = args
  if (source === undefined) return async () => undefined
  return async (signal) => {
    try {
      const reading = source.read({ userId: args.userId, projectId: args.projectId })
      args.cell.setSecrets(signal === undefined ? await reading : await abortable(reading, signal))
    } catch (error) {
      args.log?.error({
        source: 'runtime.env-secrets',
        message: `reading cloud secrets for ${args.sessionId} failed; shells keep the previous set`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
