import { ConflictException, Injectable } from '@nestjs/common'
import {
  EBootStepState,
  ESandboxProvisionState,
  EPodState,
  type PodConnectReply,
  type PodStatus,
  mintChannelTicket,
  type RecordedBootStep,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
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

const TICKET_TTL_SECONDS = 60

@Injectable()
export class ThreadPodService {
  constructor(private readonly endpoints: SandboxEndpointService) {}

  async status(args: { userId: string; threadId: string }): Promise<PodStatus> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const row = await db.orm.public.CloudSandbox.first({ threadId })
    const steps = await readBootSteps({ threadId })
    return {
      state: stateOf({ row, steps }),
      steps: latestAttemptOf(steps),
      history: steps,
    }
  }

  async connect(args: { userId: string; threadId: string }): Promise<PodConnectReply> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const endpoint = await this.endpoints.runningEndpoint({ userId, threadId })
    if (endpoint === null) {
      throw new ConflictException({
        code: 'pod-not-running',
        message: 'the pod for this thread is not running',
      })
    }
    const { ticket, expiresAt } = mintChannelTicket({
      serveToken: endpoint.token,
      threadId,
      ttlSeconds: TICKET_TTL_SECONDS,
      nowMs: Date.now(),
    })
    return { url: endpoint.url, token: ticket, expiresAt }
  }
}
