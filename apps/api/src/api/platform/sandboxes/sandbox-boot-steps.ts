import type { BootStepEvent, CloneRepoProgress, RecordedBootStep } from '@dltech/atlas-wire'
import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  cloneRepoProgressSchema,
  EVercelCredentialGap,
  latestBootAttemptOf,
} from '@dltech/atlas-wire'
import { z } from 'zod'
import { db, type Tx } from '@dltech/atlas-db'
import { podSessionOf } from '../sessions/session-of-thread'

type Writer = Pick<Tx, 'orm'>

const jsonRepoOf = (repo: CloneRepoProgress) => ({
  repo: repo.repo,
  state: repo.state,
  ...(repo.error === undefined ? {} : { error: repo.error }),
})

export async function recordBootSteps(args: {
  writer?: Writer | undefined
  threadId: string
  steps: readonly BootStepEvent[]
}): Promise<void> {
  const writer = args.writer ?? db
  if (args.steps.length === 0) return
  const sessionId = await podSessionOf({ reader: writer, threadId: args.threadId })
  await writer.orm.public.SandboxBootStep.createAll(
    args.steps.map((step) => ({
      sessionId,
      step: step.step,
      state: step.state,
      error: step.error ?? null,
      gap: step.gap ?? null,
      outcome: step.outcome ?? null,
      repos: step.repos === undefined ? null : step.repos.map(jsonRepoOf),
    })),
  )
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

const reposSchema = z.array(cloneRepoProgressSchema)

const reposOf = (value: unknown): { repos?: CloneRepoProgress[] } => {
  const parsed = reposSchema.safeParse(value)
  return parsed.success ? { repos: parsed.data } : {}
}

export async function readBootSteps(args: {
  reader?: Writer | undefined
  threadId: string
  sessionId?: string
}): Promise<RecordedBootStep[]> {
  const reader = args.reader ?? db
  const sessionId = args.sessionId ?? (await podSessionOf({ reader, threadId: args.threadId }))
  const rows = await reader.orm.public.SandboxBootStep.where({ sessionId })
    .orderBy((step) => step.seq.asc())
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
        ...reposOf(row.repos),
      },
    ]
  })
}

export const latestAttemptOf = (steps: RecordedBootStep[]): RecordedBootStep[] =>
  latestBootAttemptOf(steps)
