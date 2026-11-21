import { Sandbox, Snapshot } from '@vercel/sandbox'
import { db } from '@dltech/atlas-db'
import { ECredentialSource } from '@dltech/atlas-protocol'

import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../src/api/cloud/secrets/sealed-secret'
import { isPodSandboxName, podSessionIdOfSandboxName } from '../src/agent'
import { workerEnvService } from '../src/trigger/github/github-sweep-graph'
import {
  byokPodIdsOf,
  planByokRetire,
  retirePatchOf,
  sessionsByUserOf,
  type ByokSessionRow,
  type PodSandboxRow,
} from './retire-byok-plan'

type Credentials = { token: string; teamId: string; projectId: string }
type Counts = {
  users: number
  withoutCredential: number
  sandboxesScanned: number
  stopped: number
  deleted: number
  snapshots: number
  failed: number
  rowsRetired: number
}

const LIST_PAGE_LIMIT = 50

const args = process.argv.slice(2)
const apply = args.includes('--apply')

const counts: Counts = {
  users: 0,
  withoutCredential: 0,
  sandboxesScanned: 0,
  stopped: 0,
  deleted: 0,
  snapshots: 0,
  failed: 0,
  rowsRetired: 0,
}

const log = (line: string): void => {
  console.log(line)
}

async function credentialsOf(userId: string): Promise<Credentials | null> {
  const row = await db.orm.public.UserVercelCredential.first({ userId })
  if (row === null || row.sealedToken === null || row.vercelProjectId === null) return null
  const cipher = new SecretCipherService(workerEnvService())
  const token = openSecretValue({ cipher, sealed: row.sealedToken })
  return { token, teamId: row.teamId, projectId: row.vercelProjectId }
}

async function podSandboxesOf(credentials: Credentials): Promise<PodSandboxRow[]> {
  const pages = await Sandbox.list({ ...credentials, limit: LIST_PAGE_LIMIT })
  const sandboxes = await pages.toArray()
  return sandboxes.flatMap((sandbox) => {
    if (!isPodSandboxName(sandbox.name)) return []
    return [
      {
        name: sandbox.name,
        podSessionId: podSessionIdOfSandboxName(sandbox.name),
        running: sandbox.status === 'running',
      },
    ]
  })
}

async function retireSandbox(args: {
  credentials: Credentials
  sandbox: PodSandboxRow
  stop: boolean
}): Promise<void> {
  const instance = await Sandbox.get({
    ...args.credentials,
    name: args.sandbox.name,
    resume: false,
  })
  const snapshots = await (await instance.listSnapshots({ limit: LIST_PAGE_LIMIT })).toArray()
  if (args.stop && instance.status === 'running') {
    await instance.stop()
    counts.stopped += 1
  }
  await instance.delete()
  counts.deleted += 1
  for (const snapshot of snapshots) {
    const held = await Snapshot.get({ ...args.credentials, snapshotId: snapshot.id })
    await held.delete()
    counts.snapshots += 1
  }
}

async function retireByokSessions(): Promise<void> {
  const sessions = await db.orm.v2.V2Session.where({
    credentialSource: ECredentialSource.Byok,
  })
    .where((session) => session.deletedAt.isNull())
    .select('id', 'userId', 'podSessionId', 'archivedAt')
    .all()
  const rows: ByokSessionRow[] = sessions.map((session) => ({
    sessionId: session.id,
    userId: session.userId,
    podSessionId: session.podSessionId,
    archivedAt: session.archivedAt,
  }))
  log(`${rows.length} v2 sessions still pinned to byok`)
  const pods = byokPodIdsOf(rows)
  const byUser = sessionsByUserOf(rows)
  for (const [userId, userRows] of byUser) {
    counts.users += 1
    const credentials = await credentialsOf(userId)
    if (credentials === null) {
      counts.withoutCredential += 1
      log(`${userId}: no vercel credential, ${userRows.length} session rows retire without pods`)
    } else {
      await retirePodsOfUser({ userId, credentials, pods })
    }
    const now = new Date()
    for (const session of userRows) {
      const patch = retirePatchOf({ session, now })
      log(`  ${session.sessionId}: archivedAt=${patch.archivedAt.toISOString()} deletedAt=now`)
      if (apply) {
        await db.orm.v2.V2Session.where({ id: session.sessionId }).update(patch)
        counts.rowsRetired += 1
      }
    }
  }
}

async function retirePodsOfUser(args: {
  userId: string
  credentials: Credentials
  pods: ReadonlySet<string>
}): Promise<void> {
  const sandboxes = await podSandboxesOf(args.credentials)
  counts.sandboxesScanned += sandboxes.length
  const plan = planByokRetire({ sandboxes, pods: args.pods })
  log(
    `${args.userId}: ${sandboxes.length} pod sandboxes, ${plan.remove.length} to delete, ` +
      `${plan.stop.length} to stop, ${plan.keep.length} kept`,
  )
  const stopping = new Set(plan.stop.map((sandbox) => sandbox.name))
  for (const sandbox of plan.remove) {
    log(`  ${sandbox.name}: stop=${stopping.has(sandbox.name)} delete=true`)
    if (!apply) continue
    try {
      await retireSandbox({
        credentials: args.credentials,
        sandbox,
        stop: stopping.has(sandbox.name),
      })
    } catch (failure) {
      counts.failed += 1
      log(`  ${sandbox.name}: failed ${failure instanceof Error ? failure.message : 'unknown'}`)
    }
  }
}

async function main(): Promise<void> {
  log(apply ? 'retiring byok sessions for real' : 'dry run — pass --apply to retire')
  await retireByokSessions()
  log(
    `${apply ? 'retired' : 'would retire'}: ${counts.users} owners, ` +
      `${counts.sandboxesScanned} pod sandboxes scanned, ${counts.stopped} stopped, ` +
      `${counts.deleted} deleted, ${counts.snapshots} snapshots deleted, ` +
      `${counts.rowsRetired} session rows retired, ${counts.withoutCredential} owners with no credential, ` +
      `${counts.failed} failures`,
  )
  if (counts.failed > 0) process.exitCode = 1
}

await main()
