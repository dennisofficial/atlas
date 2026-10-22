import type { BootStepEvent, RecordedBootStep } from '@dltech/atlas-wire'
import { EBootStep, EBootStepState } from '@dltech/atlas-wire'
import { db, type Tx } from '@dltech/atlas-db'

type Writer = Pick<Tx, 'orm'>

export async function recordBootSteps(args: {
  writer?: Writer | undefined
  threadId: string
  steps: readonly BootStepEvent[]
}): Promise<void> {
  const writer = args.writer ?? db
  for (const step of args.steps) {
    await writer.orm.public.SandboxBootStep.create({
      threadId: args.threadId,
      step: step.step,
      state: step.state,
      error: step.error ?? null,
    })
  }
}

const isStep = (value: string): value is EBootStep =>
  (Object.values(EBootStep) as string[]).includes(value)
const isState = (value: string): value is EBootStepState =>
  (Object.values(EBootStepState) as string[]).includes(value)

export async function readBootSteps(args: {
  reader?: Writer | undefined
  threadId: string
}): Promise<RecordedBootStep[]> {
  const rows = await (args.reader ?? db).orm.public.SandboxBootStep.where({
    threadId: args.threadId,
  })
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
      },
    ]
  })
}

export const latestAttemptOf = (steps: RecordedBootStep[]): RecordedBootStep[] => {
  const isProvision = (step: RecordedBootStep) => step.step === EBootStep.Provision
  const start = steps.findLastIndex(
    (step) => isProvision(step) && step.state === EBootStepState.Running,
  )
  const from = start === -1 ? steps.findLastIndex(isProvision) : start
  return from === -1 ? steps : steps.slice(from)
}
