import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { hasBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { wakeClaimActive } from '../../platform/sandboxes/sandbox-lifecycle'
import { standingStateOf } from '../../platform/sandboxes/pod-state'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { podRootThreadOf } from '../../platform/sessions/pod-root'
import { podSessionsOf } from '../../platform/sessions/session-of-thread'

export const STUCK_THRESHOLD_MS = 10 * 60 * 1_000

const USER_SAID = 'user-said'

const MAX_FAMILY_DEPTH = 8

export type StuckSessionTarget = {
  threadId: string
  stuckThreadId: string
  unansweredSince: Date
  sandbox: Row<'CloudSandbox'>
}

type UnansweredThread = { threadId: string; unansweredSince: Date }

async function standingSandboxes(args: { cutoff: Date }): Promise<Row<'CloudSandbox'>[]> {
  const rows = await db.orm.public.CloudSandbox.where({ state: ESandboxState.Running })
    .where((sandbox) => sandbox.serveUrl.isNotNull())
    .where((sandbox) => sandbox.lastActivityAt.lt(args.cutoff))
    .all()
  return rows.filter(
    (row) => standingStateOf(row) === ESandboxProvisionState.Running && !wakeClaimActive(row),
  )
}

async function familySessionOwners(args: {
  sandboxes: readonly Row<'CloudSandbox'>[]
}): Promise<Map<string, string>> {
  const podOf = new Map(args.sandboxes.map((sandbox) => [sandbox.sessionId, sandbox.sessionId]))
  let frontier = args.sandboxes.map((sandbox) => sandbox.sessionId)
  for (let hop = 0; hop < MAX_FAMILY_DEPTH && frontier.length > 0; hop += 1) {
    const children = await db.orm.public.Session.where((session) =>
      session.managedBySessionId.in(frontier),
    ).all()
    const unseen = children.filter((child) => !podOf.has(child.id))
    const owners = await podSessionsOf({ reader: db, sessions: unseen })
    frontier = []
    for (const child of unseen) {
      const parentPod = podOf.get(child.managedBySessionId ?? '')
      if (parentPod === undefined || owners.get(child.id) !== parentPod) continue
      podOf.set(child.id, parentPod)
      frontier.push(child.id)
    }
  }
  return podOf
}

async function unansweredUserSaid(args: {
  thread: Pick<Row<'Thread'>, 'id' | 'lastAssistantSeq'>
  cutoff: Date
}): Promise<UnansweredThread | null> {
  const { thread, cutoff } = args
  const event = await db.orm.public.Event.where({ threadId: thread.id, type: USER_SAID })
    .where((row) => row.seq.gt(thread.lastAssistantSeq))
    .where((row) => row.at.lt(cutoff))
    .orderBy((row) => row.at.asc())
    .first()
  return event === null ? null : { threadId: thread.id, unansweredSince: event.at }
}

async function oldestUnansweredByPod(args: {
  podOf: ReadonlyMap<string, string>
  cutoff: Date
}): Promise<Map<string, UnansweredThread>> {
  const { podOf, cutoff } = args
  const threads = await db.orm.public.Thread.where((thread) =>
    thread.sessionId.in([...podOf.keys()]),
  )
    .select('id', 'sessionId', 'head', 'lastAssistantSeq', 'updatedAt')
    .all()
  const activePods = new Set(
    threads.flatMap((thread) =>
      thread.updatedAt >= cutoff ? [podOf.get(thread.sessionId) ?? thread.sessionId] : [],
    ),
  )
  const oldest = new Map<string, UnansweredThread>()
  for (const thread of threads) {
    const podSessionId = podOf.get(thread.sessionId)
    if (podSessionId === undefined || activePods.has(podSessionId)) continue
    if (thread.head <= thread.lastAssistantSeq) continue
    const unanswered = await unansweredUserSaid({ thread, cutoff })
    if (unanswered === null) continue
    const held = oldest.get(podSessionId)
    if (held === undefined || unanswered.unansweredSince < held.unansweredSince) {
      oldest.set(podSessionId, unanswered)
    }
  }
  return oldest
}

export async function stuckSessionTargets(
  args: { now?: Date | undefined } = {},
): Promise<StuckSessionTarget[]> {
  const cutoff = new Date((args.now ?? new Date()).getTime() - STUCK_THRESHOLD_MS)
  const sandboxes = await standingSandboxes({ cutoff })
  if (sandboxes.length === 0) return []
  const podOf = await familySessionOwners({ sandboxes })
  const oldest = await oldestUnansweredByPod({ podOf, cutoff })
  const targets: StuckSessionTarget[] = []
  for (const sandbox of sandboxes) {
    const stuck = oldest.get(sandbox.sessionId)
    if (stuck === undefined) continue
    const threadId = await podRootThreadOf({ threadId: stuck.threadId })
    if (!(await hasBootSteps({ threadId }))) continue
    targets.push({
      threadId,
      stuckThreadId: stuck.threadId,
      unansweredSince: stuck.unansweredSince,
      sandbox,
    })
  }
  return targets.sort((a, b) => a.unansweredSince.getTime() - b.unansweredSince.getTime())
}
