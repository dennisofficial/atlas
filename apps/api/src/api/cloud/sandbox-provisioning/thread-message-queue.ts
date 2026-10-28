import { EBootStep, EBootStepState, type RecordedBootStep } from '@dltech/atlas-wire'
import type { Tx } from '@dltech/atlas-db'
import {
  hasBootSteps,
  latestAttemptOf,
  readBootSteps,
} from '../../platform/sandboxes/sandbox-boot-steps'
import { appendWithin, nextRunId } from '../../platform/sessions/append'
import { findUserSaid, userSaidDraftOf } from './first-message'

const agentStarted = (step: RecordedBootStep): boolean =>
  step.step === EBootStep.Agent &&
  (step.state === EBootStepState.Running || step.state === EBootStepState.Done)

export async function agentStartedIn(args: { tx: Tx; threadId: string }): Promise<boolean> {
  const attempt = latestAttemptOf(await readBootSteps({ reader: args.tx, threadId: args.threadId }))
  return attempt.some(agentStarted)
}

export async function servesLiveIn(args: { tx: Tx; threadId: string }): Promise<boolean> {
  if (!(await hasBootSteps({ reader: args.tx, threadId: args.threadId }))) return true
  return agentStartedIn(args)
}

export async function appendUserSaid(args: {
  tx: Tx
  threadId: string
  userId: string
  sendId: string
  text: string
}): Promise<{ head?: number }> {
  const { tx, threadId, userId, sendId, text } = args
  if ((await findUserSaid({ reader: tx, threadId, sendId })) !== null) return {}
  const [appended] = await appendWithin({
    tx,
    threadId,
    userId,
    runId: nextRunId(),
    drafts: [userSaidDraftOf({ sendId, text })],
  })
  return appended === undefined ? {} : { head: appended.seq }
}
