import { schedules } from '@trigger.dev/sdk'
import { softDeleteArchivedSessionsIn } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import {
  platformCredentialsOf,
  readPodsEnv,
  sandboxProvidersOf,
  uniqueScopes,
  pods,
  type PodSweepScope,
} from '@dltech/atlas-pods'
import { EPreviewTunnelState } from '@dltech/atlas-previews'
import '../init'
import { triggerLog } from '../trigger-logger'
import { runOrphanPodSweep } from './orphan-pod-sweep'

const podScopesOf = async (): Promise<PodSweepScope[]> => {
  const env = readPodsEnv()
  const sandbox = sandboxProvidersOf({ env, db })
  const scopes: PodSweepScope[] = []
  for (const provider of [ESandboxProvider.Vercel, ESandboxProvider.Agent37]) {
    const credentials = platformCredentialsOf({ provider, env })
    if ('configured' in credentials) continue
    scopes.push({ label: `platform/${provider}`, credentials, sandbox: sandbox.for(provider) })
  }
  return uniqueScopes(scopes)
}

export const orphanPodSweepTask = schedules.task({
  id: 'orphan-pod-sweep',
  cron: { pattern: '5 * * * *', window: '0m' },
  retry: { maxAttempts: 3 },
  run: async () => {
    const now = new Date()
    return runOrphanPodSweep({
      now,
      log: (line) => triggerLog.log(line),
      deps: {
        pods: () => pods({ now }),
        podScopes: podScopesOf,
        softDeleteArchived: ({ cutoff, at }) =>
          db.transaction((tx) => softDeleteArchivedSessionsIn({ tx, cutoff, at })),
        markPreviewDeleting: async ({ podSessionId }) => {
          await db.orm.public.PreviewTunnel.where({ podSessionId }).updateAndCount({
            state: EPreviewTunnelState.Deleting,
          })
        },
      },
    })
  },
})
