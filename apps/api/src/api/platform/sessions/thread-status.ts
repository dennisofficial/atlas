import { EBootStepState, EPodState } from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { podStateOf } from '../sandboxes/pod-state'
import type { ThreadStatusDto } from './sessions.types'

type Awaiting = ThreadStatusDto['awaiting']
type Outcome = ThreadStatusDto['lastOutcome']

const awaitingOf = (value: string | null): Awaiting =>
  value === 'approval' || value === 'input' ? value : null

const outcomeOf = (value: string | null): Outcome =>
  value === 'completed' || value === 'failed' || value === 'stopped' ? value : null

const bootStateOf = (value: string): EBootStepState | undefined =>
  Object.values(EBootStepState).find((state) => state === value)

async function lastBootStates(threadIds: string[]): Promise<Map<string, EBootStepState>> {
  const steps = await db.orm.public.SandboxBootStep.where((step) => step.threadId.in(threadIds))
    .orderBy((step) => step.at.asc())
    .all()
  const last = new Map<string, EBootStepState>()
  for (const step of steps) {
    const state = bootStateOf(step.state)
    if (state === undefined) last.delete(step.threadId)
    else last.set(step.threadId, state)
  }
  return last
}

export async function threadStatuses(args: {
  rows: readonly Row<'Thread'>[]
  viewerId: string
}): Promise<Map<string, ThreadStatusDto>> {
  const threadIds = args.rows.map((row) => row.id)
  if (threadIds.length === 0) return new Map()
  const [sandboxes, bootStates, reads] = await Promise.all([
    db.orm.public.CloudSandbox.where((sandbox) => sandbox.threadId.in(threadIds)).all(),
    lastBootStates(threadIds),
    db.orm.public.ThreadRead.where({ userId: args.viewerId })
      .where((read) => read.threadId.in(threadIds))
      .all(),
  ])
  const sandboxByThread = new Map(sandboxes.map((sandbox) => [sandbox.threadId, sandbox]))
  const readByThread = new Map(reads.map((read) => [read.threadId, read.seq]))
  return new Map(
    args.rows.map((row) => {
      const podState = podStateOf({
        row: sandboxByThread.get(row.id) ?? null,
        lastBootStepState: bootStates.get(row.id),
      })
      const running = podState === EPodState.Running
      const status: ThreadStatusDto = {
        working: running && row.working,
        awaiting: running ? awaitingOf(row.awaiting) : null,
        lastOutcome: outcomeOf(row.lastOutcome),
        podState,
        lastAssistantSeq: row.lastAssistantSeq,
        readSeq: readByThread.get(row.id) ?? null,
      }
      return [row.id, status]
    }),
  )
}
