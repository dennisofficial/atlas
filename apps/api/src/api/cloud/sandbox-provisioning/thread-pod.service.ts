import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  ESandboxProvisionState,
  EPodResizeApplies,
  EPodState,
  type PodResizeReply,
  type PodResources,
  type PodConnectReply,
  type PodStatus,
  mintChannelTicket,
  type RecordedBootStep,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import {
  SandboxMissingError,
  VercelSandboxClient,
} from '../../platform/sandboxes/vercel-sandbox.client'
import {
  hasBootSteps,
  latestAttemptOf,
  readBootSteps,
} from '../../platform/sandboxes/sandbox-boot-steps'
import { ownedThread } from '../../platform/sessions/ownership'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { dispatchFailure, PodLaunchService } from './pod-launch.service'
import { podStateOf, standingStateOf } from '../../platform/sandboxes/pod-state'
import { SANDBOX_BUSY_MESSAGE } from './sandbox-provisioning-rows'

const TICKET_TTL_SECONDS = 60
const RESIZE_PARK_REASON = 'the sandbox is restarting to apply a new size'

export const RESIZE_UNMANAGED_MESSAGE =
  'This sandbox was started from the terminal and cannot be resized here.'

@Injectable()
export class ThreadPodService {
  private readonly logger = new Logger(ThreadPodService.name)

  constructor(
    private readonly endpoints: SandboxEndpointService,
    private readonly vercel: VercelSandboxClient,
    private readonly sandboxes: SandboxesService,
    private readonly pod: PodLaunchService,
    private readonly signals: ThreadSignalsService,
  ) {}

  async status(args: { userId: string; threadId: string }): Promise<PodStatus> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const row = await db.orm.public.CloudSandbox.first({ threadId })
    const steps = await readBootSteps({ threadId })
    return {
      state: podStateOf({ row, lastBootStepState: steps.at(-1)?.state }),
      ...(row === null ? {} : { resources: await this.resourcesOf(row) }),
      steps: latestAttemptOf(steps),
      history: steps,
    }
  }

  async resize(args: { userId: string; threadId: string; vcpus: number }): Promise<PodResizeReply> {
    const { userId, threadId, vcpus } = args
    const thread = await ownedThread({ reader: db, userId, threadId })
    const row = await db.orm.public.CloudSandbox.first({ threadId })
    if (row === null) throw new NotFoundException('this thread has no pod to resize')
    if (!(await hasBootSteps({ threadId }))) throw new ConflictException(RESIZE_UNMANAGED_MESSAGE)
    const standing = standingStateOf(row)
    if (standing === ESandboxProvisionState.Booting) {
      throw new ConflictException(SANDBOX_BUSY_MESSAGE)
    }
    await this.saveSize({ threadId, name: row.name, vcpus })
    if (standing === ESandboxProvisionState.Running) await this.restart({ thread, row })
    return { vcpus, appliesAt: EPodResizeApplies.Live }
  }

  async destroy(args: { userId: string; threadId: string }): Promise<void> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const row = await db.orm.public.CloudSandbox.first({ threadId })
    if (row === null) return
    await db.orm.public.CloudSandbox.where({ id: row.id }).updateAndCount({
      wakeClaim: null,
      updatedAt: new Date(),
    })
    await this.vercel.delete({ threadId, name: row.name })
    await db.orm.public.CloudSandbox.where({ id: row.id }).delete()
    await this.signals.podChanged({ threadId })
  }

  private async saveSize(args: { threadId: string; name: string; vcpus: number }): Promise<void> {
    try {
      await this.vercel.updateResources(args)
    } catch (failure) {
      if (failure instanceof SandboxMissingError) throw new NotFoundException(failure.message)
      throw failure
    }
  }

  private async restart(args: { thread: Row<'Thread'>; row: Row<'CloudSandbox'> }): Promise<void> {
    const { thread, row } = args
    await this.sandboxes.park({ row, reason: RESIZE_PARK_REASON })
    const { reply, dispatchFailed } = await this.pod.launch({ thread, existing: row })
    if (dispatchFailed) throw dispatchFailure()
    if (reply.state === ESandboxProvisionState.NotConfigured) {
      throw new ConflictException(reply.error)
    }
  }

  private async resourcesOf(row: Row<'CloudSandbox'>): Promise<PodResources> {
    const identity = { sandboxId: row.sandboxId, region: row.region }
    try {
      const live = await this.vercel.readResources({ threadId: row.threadId, name: row.name })
      return { ...identity, ...live }
    } catch (failure) {
      this.logger.warn(`reading resources of ${row.name} failed: ${String(failure)}`)
      return identity
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
