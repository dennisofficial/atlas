import { Logger } from '@nestjs/common'
import { schedules } from '@trigger.dev/sdk'
import { db } from '@dltech/atlas-db'
import { ESandboxState } from '../../api/platform/sandboxes/sandboxes.types'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../../api/cloud/secrets/sealed-secret'
import {
  liveSandboxNames,
  retirableSandboxNames,
  v2PodNames,
} from '../../api/cloud/sandbox-provisioning/live-sandbox-names'
import {
  planSandboxStateReconcile,
  sweepOrphanSandboxes,
  type OrphanSandbox,
  type OrphanSandboxStore,
  type SandboxStateReconciler,
} from '../../api/cloud/sandbox-provisioning/orphan-sandbox-sweep'
import { VercelOrphanSandboxStore } from '../../api/cloud/sandbox-provisioning/vercel-orphan-sandbox-store'
import { workerEnvService } from '../github/github-sweep-graph'

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

export const orphanSandboxSweepTask = schedules.task({
  id: 'orphan-sandbox-sweep',
  cron: '5 * * * *',
  retry: { maxAttempts: 3 },
  run: async () => {
    const logger = new Logger('OrphanSandboxSweep')
    const cipher = new SecretCipherService(workerEnvService())
    const pods = await v2PodNames()
    const now = new Date()
    const reconcile: SandboxStateReconciler = async ({ projectId, sandboxes }) =>
      reconcileStates({ projectId, sandboxes, now })
    return sweepOrphanSandboxes({
      stores: await storesOf({ cipher }),
      liveNames: liveSandboxNames,
      retirableNames: retirableSandboxNames,
      onRetired: async ({ name }) => {
        const sessionIds = pods.sessionIdsByName.get(name) ?? []
        if (sessionIds.length === 0) return
        await db.orm.v2.V2Session.where((session) => session.id.in(sessionIds))
          .where((session) => session.archivedAt.isNotNull())
          .update({ podRetiredAt: new Date() })
      },
      onStopped: async ({ name }) => {
        await db.orm.public.CloudSandbox.where({ name }).update({
          state: ESandboxState.Parked,
          updatedAt: new Date(),
        })
      },
      reconcileStates: reconcile,
      now,
      dryRun: false,
      log: (line) => logger.log(line),
    })
  },
})
