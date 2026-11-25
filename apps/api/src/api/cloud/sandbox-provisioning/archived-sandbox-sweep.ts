import { db, type Row } from '@dltech/atlas-db'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'

export { ARCHIVED_SANDBOX_GRACE_MS } from '@dltech/atlas-pods'
import { ARCHIVED_SANDBOX_GRACE_MS } from '@dltech/atlas-pods'

export type ArchivedSandboxSweepDeps = {
  deleteSandbox: VercelSandboxClient['delete']
  podChanged: ThreadSignalsService['podChanged']
  log: (line: string) => void
}

export type ArchivedSandboxSweepSummary = {
  scanned: number
  retired: number
  skipped: number
  failed: number
  deleted: number
}

type SweepTarget = {
  session: Pick<Row<'Session'>, 'id' | 'mainThreadId'>
  sandbox: Row<'CloudSandbox'>
}

function failureLine(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

async function sweepTargets(args: { cutoff: Date }): Promise<SweepTarget[]> {
  const sessions = await db.orm.public.Session.where((session) =>
    session.archivedAt.lt(args.cutoff),
  )
    .where((session) => session.managedBySessionId.isNull())
    .select('id', 'mainThreadId')
    .all()
  if (sessions.length === 0) return []
  const sandboxes = await db.orm.public.CloudSandbox.where((sandbox) =>
    sandbox.sessionId.in(sessions.map((session) => session.id)),
  )
    .where((sandbox) => sandbox.retiredAt.isNull())
    .all()
  const bySession = new Map(sandboxes.map((sandbox) => [sandbox.sessionId, sandbox]))
  return sessions.flatMap((session) => {
    const sandbox = bySession.get(session.id)
    return sandbox === undefined ? [] : [{ session, sandbox }]
  })
}

async function liveTeammateExists(args: { sessionId: string }): Promise<boolean> {
  const teammate = await db.orm.public.Session.where({ managedBySessionId: args.sessionId })
    .where((session) => session.archivedAt.isNull())
    .select('id')
    .first()
  return teammate !== null
}

async function apiProvisioned(args: { target: SweepTarget }): Promise<boolean> {
  const { mainThreadId } = args.target.session
  if (mainThreadId === null) return false
  const lease = await db.orm.public.LocalPodLease.where({ threadId: mainThreadId })
    .select('id')
    .first()
  if (lease !== null) return false
  const step = await db.orm.public.SandboxBootStep.where({ sessionId: args.target.session.id })
    .select('id')
    .first()
  return step !== null
}

/**
 * The row outlives the sandbox on purpose: it is the only record that this session had a pod, how
 * long it lived, and that its workspace is gone — which is what lets the client say "released"
 * instead of "parked" and refuse to pretend a resume would bring the files back.
 */
async function retireOne(args: {
  target: SweepTarget
  deps: ArchivedSandboxSweepDeps
}): Promise<'retired' | 'skipped'> {
  const { target, deps } = args
  const { sandbox } = target
  await db.orm.public.CloudSandbox.where({ id: sandbox.id }).updateAndCount({
    wakeClaim: null,
    updatedAt: new Date(),
  })
  const fresh = await db.orm.public.Session.where({ id: target.session.id })
    .select('archivedAt', 'mainThreadId')
    .first()
  if (fresh?.archivedAt === null || fresh?.archivedAt === undefined) return 'skipped'
  if (fresh.mainThreadId === null) return 'skipped'
  await deps.deleteSandbox({ threadId: fresh.mainThreadId, name: sandbox.name })
  const at = new Date()
  await db.orm.public.CloudSandbox.where({ id: sandbox.id }).updateAndCount({
    retiredAt: at,
    serveUrl: null,
    runtimeCheckpoint: null,
    runtimeCheckpointRevision: null,
    updatedAt: at,
  })
  await softDelete({ sessionId: target.session.id, at })
  await deps.podChanged({ threadId: fresh.mainThreadId })
  return 'retired'
}

async function softDelete(args: { sessionId: string; at: Date }): Promise<void> {
  await db.orm.public.Session.where({ id: args.sessionId }).updateAndCount({
    deletedAt: args.at,
  })
}

async function expiredSessions(args: { cutoff: Date }): Promise<Array<{ id: string }>> {
  const archived = await db.orm.public.Session.where((session) =>
    session.archivedAt.lt(args.cutoff),
  )
    .where((session) => session.deletedAt.isNull())
    .select('id')
    .all()
  if (archived.length === 0) return []
  const podded = await db.orm.public.CloudSandbox.where((sandbox) =>
    sandbox.sessionId.in(archived.map((session) => session.id)),
  )
    .where((sandbox) => sandbox.retiredAt.isNull())
    .select('sessionId')
    .all()
  const held = new Set(podded.map((sandbox) => sandbox.sessionId))
  return archived.filter((session) => !held.has(session.id))
}

/**
 * A session whose pod is gone — a teammate, a BYO or an already-retired main session — keeps its
 * rows for stats but stops existing for the user once its archive grace has run out.
 */
async function softDeleteExpired(args: { cutoff: Date; at: Date }): Promise<number> {
  const expired = await expiredSessions({ cutoff: args.cutoff })
  for (const session of expired) await softDelete({ sessionId: session.id, at: args.at })
  return expired.length
}

export async function sweepArchivedSandboxes(args: {
  now: Date
  deps: ArchivedSandboxSweepDeps
}): Promise<ArchivedSandboxSweepSummary> {
  const { now, deps } = args
  const cutoff = new Date(now.getTime() - ARCHIVED_SANDBOX_GRACE_MS)
  const targets = await sweepTargets({ cutoff })
  const summary: ArchivedSandboxSweepSummary = {
    scanned: targets.length,
    retired: 0,
    skipped: 0,
    failed: 0,
    deleted: 0,
  }
  for (const target of targets) {
    if (await liveTeammateExists({ sessionId: target.session.id })) {
      summary.skipped += 1
      continue
    }
    if (!(await apiProvisioned({ target }))) {
      summary.skipped += 1
      continue
    }
    try {
      const outcome = await retireOne({ target, deps })
      summary[outcome] += 1
      if (outcome === 'retired') summary.deleted += 1
    } catch (failure) {
      summary.failed += 1
      deps.log(
        `archived-sandbox-sweep failed for session ${target.session.id} (${target.sandbox.name}): ${failureLine(failure)}`,
      )
    }
  }
  summary.deleted += await softDeleteExpired({ cutoff, at: now })
  return summary
}
