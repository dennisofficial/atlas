import { db } from '@dltech/atlas-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../secrets/sealed-secret'
import type { SandboxSnapshotStore } from './sandbox-snapshot-store'
import { sweepSandboxSnapshots, type SandboxSnapshotSweepResult } from './sandbox-snapshot-sweep'
import { VercelSandboxSnapshotStore } from './vercel-sandbox-snapshot-store'

export type SandboxSnapshotSweepRun = {
  users: number
  failedUsers: number
  totals: SandboxSnapshotSweepResult
}

type CredentialRow = {
  userId: string
  sealedToken: string
  teamId: string
  vercelProjectId: string | null
}

const emptyTotals = (): SandboxSnapshotSweepResult => ({
  retentionApplied: 0,
  retentionFailed: 0,
  deleted: 0,
  deleteFailed: 0,
  bytesFreed: 0,
})

const uniqueProjects = (ids: readonly (string | null)[]): string[] => [
  ...new Set(ids.filter((id): id is string => id !== null)),
]

const pinnedProjectsOf = async (args: { userId: string }): Promise<string[]> => {
  const rows = await db.orm.public.CloudSandbox.where({ userId: args.userId })
    .select('vercelProjectId')
    .all()
  return uniqueProjects(rows.map((row) => row.vercelProjectId))
}

const addTotals = (into: SandboxSnapshotSweepResult, from: SandboxSnapshotSweepResult): void => {
  for (const key of Object.keys(into) as (keyof SandboxSnapshotSweepResult)[])
    into[key] += from[key]
}

export async function sweepAllSandboxSnapshots(args: {
  cipher: SecretCipherService
  now: () => Date
  dryRun: boolean
  log: (line: string) => void
  listCredentials?: () => Promise<CredentialRow[]>
  listPinnedProjects?: (args: { userId: string }) => Promise<string[]>
  storeFor?: (credentials: {
    token: string
    teamId: string
    projectId: string
  }) => SandboxSnapshotStore
}): Promise<SandboxSnapshotSweepRun> {
  const listCredentials = args.listCredentials ?? (() => db.orm.public.UserVercelCredential.all())
  const listPinnedProjects = args.listPinnedProjects ?? pinnedProjectsOf
  const storeFor = args.storeFor ?? ((credentials) => new VercelSandboxSnapshotStore(credentials))
  const rows = await listCredentials()
  const run: SandboxSnapshotSweepRun = { users: rows.length, failedUsers: 0, totals: emptyTotals() }
  for (const row of rows) {
    try {
      const token = openSecretValue({ cipher: args.cipher, sealed: row.sealedToken })
      const projects = uniqueProjects([
        row.vercelProjectId,
        ...(await listPinnedProjects({ userId: row.userId })),
      ])
      if (projects.length === 0) throw new Error('credential holds no project')
      for (const projectId of projects) {
        const result = await sweepSandboxSnapshots({
          store: storeFor({ token, teamId: row.teamId, projectId }),
          now: args.now,
          dryRun: args.dryRun,
        })
        args.log(
          `sandbox-snapshot-sweep user=${row.userId} project=${projectId} ${JSON.stringify(result)}`,
        )
        addTotals(run.totals, result)
      }
    } catch (failure) {
      run.failedUsers++
      args.log(`sandbox-snapshot-sweep user=${row.userId} failed: ${String(failure)}`)
    }
  }
  return run
}
