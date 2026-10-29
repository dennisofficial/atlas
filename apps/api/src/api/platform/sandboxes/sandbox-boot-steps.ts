import type { BootStepEvent, RecordedBootStep } from '@dltech/atlas-wire'
import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  EVercelCredentialGap,
  latestBootAttemptOf,
} from '@dltech/atlas-wire'
import { db, type Tx } from '@dltech/atlas-db'
import { podSessionOf } from '../sessions/session-of-thread'

type Writer = Pick<Tx, 'orm'>

export async function recordBootSteps(args: {
  writer?: Writer | undefined
  threadId: string
  steps: readonly BootStepEvent[]
}): Promise<void> {
  const writer = args.writer ?? db
  const sessionId = await podSessionOf({ reader: writer, threadId: args.threadId })
  for (const step of args.steps) {
    await writer.orm.public.SandboxBootStep.create({
      sessionId,
      step: step.step,
      state: step.state,
      error: step.error ?? null,
      gap: step.gap ?? null,
      outcome: step.outcome ?? null,
    })
  }
}

export async function hasBootSteps(args: {
  reader?: Writer | undefined
  threadId: string
}): Promise<boolean> {
  const reader = args.reader ?? db
  const sessionId = await podSessionOf({ reader, threadId: args.threadId })
  const step = await reader.orm.public.SandboxBootStep.first({ sessionId })
  return step !== null
}

const isStep = (value: string): value is EBootStep =>
  (Object.values(EBootStep) as string[]).includes(value)
const isGap = (value: string): value is EVercelCredentialGap =>
  (Object.values(EVercelCredentialGap) as string[]).includes(value)
const isOutcome = (value: string): value is EBootStepOutcome =>
  (Object.values(EBootStepOutcome) as string[]).includes(value)
const isState = (value: string): value is EBootStepState =>
  (Object.values(EBootStepState) as string[]).includes(value)

export async function readBootSteps(args: {
  reader?: Writer | undefined
  threadId: string
}): Promise<RecordedBootStep[]> {
  const reader = args.reader ?? db
  const sessionId = await podSessionOf({ reader, threadId: args.threadId })
  const rows = await reader.orm.public.SandboxBootStep.where({ sessionId })
    .orderBy((step) => step.at.asc())
    .all()
  return rows.flatMap((row) => {
    if (!isStep(row.step) || !isState(row.state)) return []
    return [
      {
        step: row.step,
        state: row.state,
        at: row.at.toISOString(),
        ...(row.error === null ? {} : { error: row.error }),
        ...(row.gap === null || !isGap(row.gap) ? {} : { gap: row.gap }),
        ...(row.outcome === null || !isOutcome(row.outcome) ? {} : { outcome: row.outcome }),
      },
    ]
  })
}

export const latestAttemptOf = (steps: RecordedBootStep[]): RecordedBootStep[] =>
  latestBootAttemptOf(steps)
