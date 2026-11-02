import { EBootStepState, EPodState, waitingForModelWireSchema } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { podSessionsOf } from './session-of-thread'
import type { ThreadWithSession } from './thread-with-session'
import { podStateOf } from '../sandboxes/pod-state'
import type { ThreadStatusDto } from './sessions.types'

type Awaiting = ThreadStatusDto['awaiting']
type Outcome = ThreadStatusDto['lastOutcome']

const awaitingOf = (value: string | null): Awaiting =>
  value === 'approval' || value === 'input' ? value : null

const outcomeOf = (value: string | null): Outcome =>
  value === 'completed' || value === 'failed' || value === 'stopped' ? value : null

const waitingOf = (value: string | null): ThreadStatusDto['waitingForModel'] => {
  if (value === null) return null
  try {
    const parsed = waitingForModelWireSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const bootStateOf = (value: string): EBootStepState | undefined =>
  Object.values(EBootStepState).find((state) => state === value)

async function lastBootStates(sessionIds: string[]): Promise<Map<string, EBootStepState>> {
  const steps = await db.orm.public.SandboxBootStep.where((step) => step.sessionId.in(sessionIds))
    .orderBy((step) => step.at.asc())
    .all()
  const last = new Map<string, EBootStepState>()
  for (const step of steps) {
    const state = bootStateOf(step.state)
    if (state === undefined) last.delete(step.sessionId)
    else last.set(step.sessionId, state)
  }
  return last
}

export async function threadStatuses(args: {
  rows: readonly ThreadWithSession[]
  viewerId: string
}): Promise<Map<string, ThreadStatusDto>> {
  const threadIds = args.rows.map(({ thread }) => thread.id)
  if (threadIds.length === 0) return new Map()
  const podSessions = await podSessionsOf({
    reader: db,
    sessions: args.rows.map(({ session }) => session),
  })
  const podSessionIds = [...new Set(podSessions.values())]
  const [sandboxes, bootStates, reads] = await Promise.all([
    db.orm.public.CloudSandbox.where((sandbox) => sandbox.sessionId.in(podSessionIds)).all(),
    lastBootStates(podSessionIds),
    db.orm.public.ThreadRead.where({ userId: args.viewerId })
      .where((read) => read.threadId.in(threadIds))
      .all(),
  ])
  const sandboxBySession = new Map(sandboxes.map((sandbox) => [sandbox.sessionId, sandbox]))
  const readByThread = new Map(reads.map((read) => [read.threadId, read.seq]))
  return new Map(
    args.rows.map(({ thread: row, session }) => {
      const podSessionId = podSessions.get(session.id) ?? session.id
      const podState = podStateOf({
        row: sandboxBySession.get(podSessionId) ?? null,
        lastBootStepState: bootStates.get(podSessionId),
      })
      const running = podState === EPodState.Running
      const status: ThreadStatusDto = {
        working: running && row.working,
        awaiting: running ? awaitingOf(row.awaiting) : null,
        lastOutcome: outcomeOf(row.lastOutcome),
        waitingForModel: waitingOf(row.waitingForModel),
        podState,
        lastAssistantSeq: row.lastAssistantSeq,
        readSeq: readByThread.get(row.id) ?? null,
      }
      return [row.id, status]
    }),
  )
}
