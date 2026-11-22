import { schedules } from '@trigger.dev/sdk'
import { db } from '@dltech/atlas-db'
import { softDeleteArchivedSessionsIn } from '@dltech/atlas-control/postgres'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../../api/cloud/secrets/sealed-secret'
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
import { workerEnvService } from '../github/github-sweep-graph'
import { runOrphanSweep } from './orphan-sweep-scopes'
import { triggerLog } from '../trigger-logger'

const projectIdsOf = (args: {
  projectId: string | null
  pinned: readonly { vercelProjectId: string | null }[]
}): string[] => [
  ...new Set(
    [args.projectId, ...args.pinned.map((row) => row.vercelProjectId)].filter(
      (id): id is string => id !== null,
    ),
  ),
]

async function storesOf(args: {
  cipher: SecretCipherService
  log: (line: string) => void
}): Promise<OrphanSandboxProject[]> {
  const env = workerEnvService()
  const entries = new Map<string, OrphanSandboxProject>()
  const add = (entry: { teamId: string; projectId: string; token: string; owner: string }) => {
    const key = `${entry.teamId}/${entry.projectId}`
    if (entries.has(key)) return
    entries.set(key, {
      label: `${entry.owner}/${entry.projectId}`,
      projectId: entry.projectId,
      store: new VercelOrphanSandboxStore({
        token: entry.token,
        teamId: entry.teamId,
        projectId: entry.projectId,
      }),
    })
  }
  for (const row of await db.orm.public.UserVercelCredential.all()) {
    try {
      if (row.sealedToken === null) continue
      const token = openSecretValue({ cipher: args.cipher, sealed: row.sealedToken })
      const pinned = await db.orm.public.CloudSandbox.where({ userId: row.userId })
        .select('vercelProjectId')
        .all()
      for (const projectId of projectIdsOf({ projectId: row.vercelProjectId, pinned })) {
        add({ teamId: row.teamId, projectId, token, owner: row.userId })
      }
    } catch (failure) {
      args.log(`${row.userId}: could not read its vercel credential: ${String(failure)}`)
    }
  }
  try {
    const envToken = env.get('VERCEL_TOKEN')
    const envTeam = env.get('VERCEL_TEAM_ID')
    const envProject = env.get('VERCEL_PROJECT_ID')
    if (envToken !== undefined && envTeam !== undefined && envProject !== undefined) {
      add({ teamId: envTeam, projectId: envProject, token: envToken, owner: 'env' })
    }
  } catch (failure) {
    args.log(`env: could not read its vercel credential: ${String(failure)}`)
  }
  return [...entries.values()]
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
    const cipher = new SecretCipherService(workerEnvService())
    return runOrphanSweep({
      now,
      log: (line) => triggerLog.log(line),
      deps: {
        pods: () => v2Pods({ now }),
        v2Scopes: () => v2ScopesOf({ env: readAgentHostEnv() }),
        stores: () => storesOf({ cipher, log: (line) => triggerLog.log(line) }),
        liveNames: () => liveSandboxNames({ now }),
        retirableNames: () => retirableSandboxNames({ now }),
        softDeleteArchived: ({ cutoff, at }) =>
          db.transaction((tx) => softDeleteArchivedSessionsIn({ tx, cutoff, at })),
      },
    })
  },
})
