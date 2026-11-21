import { schedules } from '@trigger.dev/sdk'
import { db } from '@dltech/atlas-db'
import { softDeleteArchivedSessionsIn } from '@dltech/atlas-control/postgres'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { ESandboxState } from '../../api/platform/sandboxes/sandboxes.types'
import { ARCHIVED_SANDBOX_GRACE_MS } from '../../api/cloud/sandbox-provisioning/archived-sandbox-sweep'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../../api/cloud/secrets/sealed-secret'
import {
  liveSandboxNames,
  podStillRetirable,
  retirableSandboxNames,
  v2Pods,
} from '../../api/cloud/sandbox-provisioning/live-sandbox-names'
import {
  planSandboxStateReconcile,
  sweepOrphanSandboxes,
  type OrphanSandbox,
  type OrphanSandboxStore,
  type SandboxStateReconciler,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import {
  sweepV2Pods,
  uniqueV2Scopes,
  type V2PodSweepScope,
} from '../../api/cloud/sandbox-provisioning/v2-pod-sweep'
import { VercelOrphanSandboxStore } from '../../api/cloud/sandbox-provisioning/vercel-orphan-sandbox-store'
import { endPodTerminals } from '../../api/platform/sandboxes/pod-terminals'
import { recordSandboxRunClose } from '../../agent/sandbox/sandbox-runs'
import type { AgentHostEnv } from '../../agent/config/env'
import { readAgentHostEnv } from '../../agent/config/env'
import { isPodSandboxName } from '../../agent/sandbox/vercel-names'
import { platformCredentialsOf } from '../../agent/config/platform-credentials'
import { sandboxProvidersOf } from '../../agent/sandbox/sandbox-providers'
import { workerEnvService } from '../github/github-sweep-graph'
import { triggerLog } from '../trigger-logger'

type StoreEntry = { label: string; projectId: string; store: OrphanSandboxStore }

async function reconcileStates(args: {
  projectId: string
  sandboxes: readonly OrphanSandbox[]
  now: Date
}): Promise<number> {
  const rows = await db.orm.public.CloudSandbox.where({ vercelProjectId: args.projectId })
    .select('name', 'state', 'lastActivityAt')
    .all()
  const plan = planSandboxStateReconcile({
    rows,
    sandboxes: args.sandboxes,
    now: args.now,
  })
  const at = new Date()
  for (const row of plan.park) {
    await db.orm.public.CloudSandbox.where({ name: row.name }).update({
      state: ESandboxState.Parked,
      runtimeCheckpoint: null,
      runtimeCheckpointRevision: null,
      updatedAt: at,
    })
  }
  return plan.park.length
}

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

async function storesOf(args: { cipher: SecretCipherService }): Promise<StoreEntry[]> {
  const env = workerEnvService()
  const entries = new Map<string, StoreEntry>()
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
    if (row.sealedToken === null) continue
    const token = openSecretValue({ cipher: args.cipher, sealed: row.sealedToken })
    const pinned = await db.orm.public.CloudSandbox.where({ userId: row.userId })
      .select('vercelProjectId')
      .all()
    for (const projectId of projectIdsOf({ projectId: row.vercelProjectId, pinned })) {
      add({ teamId: row.teamId, projectId, token, owner: row.userId })
    }
  }
  const envToken = env.get('VERCEL_TOKEN')
  const envTeam = env.get('VERCEL_TEAM_ID')
  const envProject = env.get('VERCEL_PROJECT_ID')
  if (envToken !== undefined && envTeam !== undefined && envProject !== undefined) {
    add({ teamId: envTeam, projectId: envProject, token: envToken, owner: 'env' })
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
    const cipher = new SecretCipherService(workerEnvService())
    const now = new Date()
    const cutoff = new Date(now.getTime() - ARCHIVED_SANDBOX_GRACE_MS)
    const pods = await v2Pods({ now })
    const v2Summary = await sweepV2Pods({
      scopes: await v2ScopesOf({ env: readAgentHostEnv() }),
      pods,
      stillRetirable: ({ podSessionId }) => podStillRetirable({ podSessionId, now }),
      onRetired: async ({ podSessionId }) => {
        const sessionIds = pods.sessionIdsByPod.get(podSessionId) ?? []
        if (sessionIds.length === 0) return
        await db.orm.v2.V2Session.where((session) => session.id.in(sessionIds))
          .where((session) => session.archivedAt.isNotNull())
          .updateAndCount({ podRetiredAt: new Date() })
      },
      onStopped: async ({ podSessionId, cpuCumulativeMs }) => {
        await recordSandboxRunClose({
          sessionId: podSessionId,
          ...(cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs }),
        })
      },
      endTerminals: (args) => endPodTerminals(args),
      now,
      dryRun: false,
      log: (line) => triggerLog.log(line),
    })
    const reconcile: SandboxStateReconciler = async ({ projectId, sandboxes }) =>
      reconcileStates({ projectId, sandboxes, now })
    const summary = await sweepOrphanSandboxes({
      stores: await storesOf({ cipher }),
      liveNames: () => liveSandboxNames({ now }),
      retirableNames: () => retirableSandboxNames({ now }),
      ignoreName: isPodSandboxName,
      onStopped: async ({ name }) => {
        await db.orm.public.CloudSandbox.where({ name }).update({
          state: ESandboxState.Parked,
          runtimeCheckpoint: null,
          runtimeCheckpointRevision: null,
          updatedAt: new Date(),
        })
      },
      reconcileStates: reconcile,
      now,
      dryRun: false,
      log: (line) => triggerLog.log(line),
    })
    const softDeleted = await db.transaction((tx) =>
      softDeleteArchivedSessionsIn({ tx, cutoff, at: now }),
    )
    triggerLog.log(`soft-deleted ${softDeleted} v2 sessions archived past the grace`)
    return { ...summary, v2: v2Summary, softDeleted }
  },
})
