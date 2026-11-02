import { db, type Row } from '@dltech/atlas-db'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'

export const ARCHIVED_SANDBOX_GRACE_MS = 7 * 24 * 60 * 60 * 1_000

export type ArchivedSandboxSweepDeps = {
  deleteSandbox: VercelSandboxClient['delete']
  podChanged: ThreadSignalsService['podChanged']
  log: (line: string) => void
}

export type ArchivedSandboxSweepSummary = {
  scanned: number
  deleted: number
  skipped: number
  failed: number
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
  ).all()
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

async function deleteOne(args: {
  target: SweepTarget
  deps: ArchivedSandboxSweepDeps
}): Promise<'deleted' | 'skipped'> {
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
  await db.orm.public.CloudSandbox.where({ id: sandbox.id }).delete()
  await deps.podChanged({ threadId: fresh.mainThreadId })
  return 'deleted'
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
    deleted: 0,
    skipped: 0,
    failed: 0,
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
      const outcome = await deleteOne({ target, deps })
      summary[outcome] += 1
    } catch (failure) {
      summary.failed += 1
      deps.log(
        `archived-sandbox-sweep failed for session ${target.session.id} (${target.sandbox.name}): ${failureLine(failure)}`,
      )
    }
  }
  return summary
}
