import { Injectable } from '@nestjs/common'
import {
  EBootStepState,
  ESandboxProvisionState,
  EPodState,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { parkedOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { latestAttemptOf, readBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ownedThread } from '../../platform/sessions/ownership'
import { failedAfterClaim, standingStateOf } from './sandbox-provisioning-rows'

function stateOf(args: { row: Row<'CloudSandbox'> | null; steps: RecordedBootStep[] }): EPodState {
  const { row, steps } = args
  const standing = row === null ? undefined : standingStateOf(row)
  if (standing === ESandboxProvisionState.Running) return EPodState.Running
  if (standing === ESandboxProvisionState.Booting) return EPodState.Booting
  if (steps.at(-1)?.state === EBootStepState.Error) return EPodState.Failed
  if (row !== null && failedAfterClaim(row)) return EPodState.Failed
  if (row !== null && parkedOf(row)) return EPodState.Parked
  return EPodState.None
}

@Injectable()
export class ThreadPodService {
  async status(args: { userId: string; threadId: string }): Promise<PodStatus> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const row = await db.orm.public.CloudSandbox.first({ threadId })
    const steps = await readBootSteps({ threadId })
    return { state: stateOf({ row, steps }), steps: latestAttemptOf(steps) }
  }
}
