import { db, type Row, type Tx } from '@dltech/atlas-db'
import type { PodStatus } from '@dltech/atlas-wire'
import { podSessionOf } from '../sessions/session-of-thread'
import { latestAttemptOf, readBootSteps } from './sandbox-boot-steps'
import { podStateOf } from './pod-state'

export async function readPodLifecycle(args: {
  threadId: string
  reader?: Pick<Tx, 'orm'>
}): Promise<{ row: Row<'CloudSandbox'> | null; status: PodStatus }> {
  const reader = args.reader ?? db
  const sessionId = await podSessionOf({ reader, threadId: args.threadId })
  const row = await reader.orm.public.CloudSandbox.first({ sessionId })
  const steps = await readBootSteps({ reader, threadId: args.threadId, sessionId })
  return {
    row,
    status: {
      state: podStateOf({ row, lastBootStepState: steps.at(-1)?.state }),
      steps: latestAttemptOf(steps),
      history: steps,
    },
  }
}

export async function readPodStatus(args: {
  threadId: string
  reader?: Pick<Tx, 'orm'>
}): Promise<PodStatus> {
  return (await readPodLifecycle(args)).status
}
