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
  vercelProjectId: string
}

export async function sweepAllSandboxSnapshots(args: {
  cipher: SecretCipherService
  now: () => Date
  dryRun: boolean
  log: (line: string) => void
  listCredentials?: () => Promise<CredentialRow[]>
  storeFor?: (credentials: {
    token: string
    teamId: string
    projectId: string
  }) => SandboxSnapshotStore
}): Promise<SandboxSnapshotSweepRun> {
  const listCredentials = args.listCredentials ?? (() => db.orm.public.UserVercelCredential.all())
  const storeFor = args.storeFor ?? ((credentials) => new VercelSandboxSnapshotStore(credentials))
  const rows = await listCredentials()
  const run: SandboxSnapshotSweepRun = {
    users: rows.length,
    failedUsers: 0,
    totals: { retentionApplied: 0, retentionFailed: 0, deleted: 0, deleteFailed: 0, bytesFreed: 0 },
  }
  for (const row of rows) {
    try {
      const token = openSecretValue({ cipher: args.cipher, sealed: row.sealedToken })
      const result = await sweepSandboxSnapshots({
        store: storeFor({ token, teamId: row.teamId, projectId: row.vercelProjectId }),
        now: args.now,
        dryRun: args.dryRun,
      })
      args.log(`sandbox-snapshot-sweep user=${row.userId} ${JSON.stringify(result)}`)
      for (const key of Object.keys(run.totals) as (keyof SandboxSnapshotSweepResult)[])
        run.totals[key] += result[key]
    } catch (failure) {
      run.failedUsers++
      args.log(`sandbox-snapshot-sweep user=${row.userId} failed: ${String(failure)}`)
    }
  }
  return run
}
