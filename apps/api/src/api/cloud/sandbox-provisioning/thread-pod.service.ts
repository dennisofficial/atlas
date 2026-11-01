import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  ESandboxProvisionState,
  EPodResizeApplies,
  type PodResizeReply,
  type PodResources,
  type PodConnectReply,
  type PodStatus,
  mintChannelTicket,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import {
  SandboxMissingError,
  VercelSandboxClient,
} from '../../platform/sandboxes/vercel-sandbox.client'
import { podSessionOf } from '../../platform/sessions/session-of-thread'
import { podRootThreadOf } from '../../platform/sessions/pod-root'
import { hasBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { readPodSnapshot } from '../../platform/sessions/pod-snapshot'
import { ownedThread } from '../../platform/sessions/ownership'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { dispatchFailure, PodLaunchService } from './pod-launch.service'
import { standingStateOf } from '../../platform/sandboxes/pod-state'
import { SANDBOX_BUSY_MESSAGE } from './sandbox-provisioning-rows'
import { PodResourcesCache } from './pod-resources-cache'

const TICKET_TTL_SECONDS = 60

export const RESIZE_UNMANAGED_MESSAGE =
  'This sandbox was started from the terminal and cannot be resized here.'

@Injectable()
export class ThreadPodService {
  private readonly logger = new Logger(ThreadPodService.name)
  private readonly liveResources: PodResourcesCache

  constructor(
    private readonly endpoints: SandboxEndpointService,
    private readonly vercel: VercelSandboxClient,
    private readonly pod: PodLaunchService,
    private readonly signals: ThreadSignalsService,
    @Inject(BackgroundWork) background: BackgroundWork,
  ) {
    this.liveResources = new PodResourcesCache(background, ({ key, failure }) =>
      this.logger.warn(`reading resources of ${key} failed: ${String(failure)}`),
    )
  }

  async status(args: { userId: string; threadId: string }): Promise<PodStatus> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const { row, status } = await readPodSnapshot({ threadId })
    return {
      ...status,
      ...(row === null ? {} : { resources: await this.resourcesOf({ row, threadId }) }),
    }
  }

  async resize(args: { userId: string; threadId: string; vcpus: number }): Promise<PodResizeReply> {
    const { userId, threadId, vcpus } = args
    const thread = await ownedThread({ reader: db, userId, threadId })
    const sessionId = await podSessionOf({ reader: db, threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    if (row === null) throw new NotFoundException('this thread has no pod to resize')
    if (!(await hasBootSteps({ threadId }))) throw new ConflictException(RESIZE_UNMANAGED_MESSAGE)
    const standing = standingStateOf(row)
    if (standing === ESandboxProvisionState.Booting) {
      throw new ConflictException(SANDBOX_BUSY_MESSAGE)
    }
    if (standing === ESandboxProvisionState.Running) {
      await this.restart({ thread, row, vcpus })
    } else {
      await this.saveSize({ threadId, name: row.name, vcpus })
    }
    return { vcpus, appliesAt: EPodResizeApplies.Live }
  }

  async destroy(args: { userId: string; threadId: string }): Promise<void> {
    const { userId, threadId } = args
    await ownedThread({ reader: db, userId, threadId })
    const sessionId = await podSessionOf({ reader: db, threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    if (row === null) return
    await db.orm.public.CloudSandbox.where({ id: row.id }).updateAndCount({
      wakeClaim: null,
      updatedAt: new Date(),
    })
    await this.vercel.delete({ threadId, name: row.name })
    this.liveResources.forget(row.name)
    await db.orm.public.CloudSandbox.where({ id: row.id }).delete()
    await this.signals.podChanged({ threadId })
  }

  private async saveSize(args: { threadId: string; name: string; vcpus: number }): Promise<void> {
    try {
      await this.vercel.updateResources(args)
      this.liveResources.forget(args.name)
    } catch (failure) {
      if (failure instanceof SandboxMissingError) throw new NotFoundException(failure.message)
      throw failure
    }
  }

  private async restart(args: {
    thread: Row<'Thread'>
    row: Row<'CloudSandbox'>
    vcpus: number
  }): Promise<void> {
    const { thread, row, vcpus } = args
    const { reply, dispatchFailed } = await this.pod.launch({
      thread,
      existing: row,
      pendingVcpus: vcpus,
    })
    this.liveResources.forget(row.name)
    if (dispatchFailed) throw dispatchFailure()
    if (reply.state === ESandboxProvisionState.NotConfigured) {
      throw new ConflictException(reply.error)
    }
  }

  private async resourcesOf(args: {
    row: Row<'CloudSandbox'>
    threadId: string
  }): Promise<PodResources> {
    const { row } = args
    const identity = {
      sandboxId: row.sandboxId,
      region: row.region,
      ...(row.pendingVcpus === null ? {} : { pendingVcpus: row.pendingVcpus }),
    }
    const live = await this.liveResources.resolve({
      key: row.name,
      read: () => this.vercel.readResources({ threadId: args.threadId, name: row.name }),
    })
    return { ...live, ...identity }
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
    const rootThreadId = await podRootThreadOf({ threadId })
    const { ticket, expiresAt } = mintChannelTicket({
      serveToken: endpoint.token,
      threadId: rootThreadId,
      ttlSeconds: TICKET_TTL_SECONDS,
      nowMs: Date.now(),
    })
    return { url: endpoint.url, token: ticket, expiresAt, threadId: rootThreadId }
  }
}
