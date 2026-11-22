import { schedules } from '@trigger.dev/sdk'
import { db } from '@dltech/atlas-db'
import { softDeleteArchivedSessionsIn } from '@dltech/atlas-control/postgres'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import {
  liveSandboxNames,
  retirableSandboxNames,
  v2Pods,
} from '../../api/cloud/sandbox-provisioning/live-sandbox-names'
import type { OrphanSandboxProject } from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import {
  uniqueV2Scopes,
  type V2PodSweepScope,
} from '../../api/cloud/sandbox-provisioning/v2-pod-sweep'
import { VercelOrphanSandboxStore } from '../../api/cloud/sandbox-provisioning/vercel-orphan-sandbox-store'
import type { AgentHostEnv } from '../../agent/config/env'
import { readAgentHostEnv } from '../../agent/config/env'
import { platformCredentialsOf } from '../../agent/config/platform-credentials'
import { sandboxProvidersOf } from '../../agent/sandbox/sandbox-providers'
import { runOrphanSweep } from './orphan-sweep-scopes'
import { triggerLog } from '../trigger-logger'

export async function storesOf(args: {
  env: Pick<AgentHostEnv, 'platformVercel'>
  log: (line: string) => void
}): Promise<OrphanSandboxProject[]> {
  const vercel = args.env.platformVercel
  if (vercel === null) {
    args.log('platform: PLATFORM_VERCEL_TOKEN/TEAM_ID/PROJECT_ID are not configured')
    return []
  }
  return [
    {
      label: `platform/${vercel.projectId}`,
      projectId: vercel.projectId,
      store: new VercelOrphanSandboxStore(vercel),
    },
  ]
}

/**
 * Every credential set a v2 pod can exist under: v2 sessions only ever run on the platform's own
 * Vercel project and Agent37 account, so those are the only accounts swept.
 */
async function v2ScopesOf(args: { env: AgentHostEnv }): Promise<V2PodSweepScope[]> {
  const sandbox = sandboxProvidersOf({ env: args.env, db })
  const scopes: V2PodSweepScope[] = []
  for (const provider of [ESandboxProvider.Vercel, ESandboxProvider.Agent37]) {
    const credentials = platformCredentialsOf({ provider, env: args.env })
    if ('configured' in credentials) continue
    scopes.push({ label: `platform/${provider}`, credentials, sandbox: sandbox.for(provider) })
  }
  return uniqueV2Scopes(scopes)
}

export const orphanSandboxSweepTask = schedules.task({
  id: 'orphan-sandbox-sweep',
  cron: '5 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => {
    const now = new Date()
    const log = (line: string) => triggerLog.log(line)
    return runOrphanSweep({
      now,
      log,
      deps: {
        pods: () => v2Pods({ now }),
        v2Scopes: () => v2ScopesOf({ env: readAgentHostEnv() }),
        stores: () => storesOf({ env: readAgentHostEnv(), log }),
        liveNames: () => liveSandboxNames({ now }),
        retirableNames: () => retirableSandboxNames({ now }),
        softDeleteArchived: ({ cutoff, at }) =>
          db.transaction((tx) => softDeleteArchivedSessionsIn({ tx, cutoff, at })),
      },
    })
  },
})
