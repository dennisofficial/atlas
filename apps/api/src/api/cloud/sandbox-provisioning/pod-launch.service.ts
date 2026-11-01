import { BadGatewayException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  EBootStep,
  EBootStepState,
  ESandboxProvisionState,
  type SandboxProvisionReply,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { podSessionOf, sessionOfThread } from '../../platform/sessions/session-of-thread'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { failureText } from '../github/github-sandbox-wake-boot'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { ScopedConfigService, type ThreadOwner } from '../scoped-config/scoped-config.service'
import {
  podProvisionIdempotencyKey,
  podProvisionTaskContract,
  type PodProvisionPayload,
} from './pod-provision.contract'
import { assignCreatorConnections } from './pod-oauth-assign'
import { claimRow, markFailed, type RowClaim, type RowWriter } from './sandbox-provisioning-rows'

export const DISPATCH_FAILED_MESSAGE = "Couldn't start the sandbox. Retry."

export const dispatchFailedReply: SandboxProvisionReply = {
  state: ESandboxProvisionState.Booting,
  error: DISPATCH_FAILED_MESSAGE,
}

export type PodLaunchOutcome = { reply: SandboxProvisionReply; dispatchFailed: boolean }

export const notConfiguredReplyOf = (failure: VercelNotConfiguredError): SandboxProvisionReply => ({
  state: ESandboxProvisionState.NotConfigured,
  error: failure.message,
  gap: failure.gap,
})

@Injectable()
export class PodLaunchService {
  private readonly logger = new Logger(PodLaunchService.name)

  constructor(
    private readonly scoped: ScopedConfigService,
    private readonly cipher: SecretCipherService,
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
    private readonly signals: ThreadSignalsService,
  ) {}

  async credentialsOf(owner: ThreadOwner): Promise<VercelNotConfiguredError | null> {
    try {
      await this.scoped.vercelCredentials({ thread: owner })
      return null
    } catch (failure) {
      if (failure instanceof VercelNotConfiguredError) return failure
      throw failure
    }
  }

  reportGap(args: {
    writer?: RowWriter | undefined
    threadId: string
    failure: VercelNotConfiguredError
  }): Promise<void> {
    return recordBootSteps({
      writer: args.writer,
      threadId: args.threadId,
      steps: [
        {
          step: EBootStep.Provision,
          state: EBootStepState.Error,
          error: args.failure.message,
          gap: args.failure.gap,
        },
      ],
    })
  }

  claim(args: {
    writer?: RowWriter | undefined
    thread: Row<'Thread'>
    existing: Row<'CloudSandbox'> | null
    pendingVcpus?: number | undefined
  }): Promise<RowClaim | null> {
    const { writer, ...rest } = args
    if (writer === undefined)
      return db.transaction((tx) => this.claimWithin({ ...rest, writer: tx }))
    return this.claimWithin({ ...rest, writer })
  }

  private async claimWithin(args: {
    writer: RowWriter
    thread: Row<'Thread'>
    existing: Row<'CloudSandbox'> | null
    pendingVcpus?: number | undefined
  }): Promise<RowClaim | null> {
    const claim = await claimRow({ ...args, cipher: this.cipher })
    if (claim === null) return null
    await assignCreatorConnections({
      writer: args.writer,
      thread: args.thread,
      sandboxId: claim.sandboxId,
    })
    await recordBootSteps({
      writer: args.writer,
      threadId: args.thread.id,
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Running }],
    })
    return claim
  }

  async dispatch(args: {
    threadId: string
    claim: RowClaim
    stopSessionId?: string | undefined
  }): Promise<boolean> {
    const payload: PodProvisionPayload = {
      threadId: args.threadId,
      wakeClaim: args.claim.wakeClaim.toISOString(),
      ...(args.stopSessionId === undefined ? {} : { stopSessionId: args.stopSessionId }),
    }
    try {
      await this.dispatcher.dispatch({
        task: podProvisionTaskContract,
        payload,
        idempotencyKey: podProvisionIdempotencyKey(payload),
      })
      return true
    } catch (failure) {
      this.logger.warn(
        `dispatching pod-provision for thread ${args.threadId} failed: ${failureText(failure)}`,
      )
      await this.recordDispatchFailure({ threadId: args.threadId, claim: args.claim })
      return false
    }
  }

  async launch(args: {
    thread: Row<'Thread'>
    existing: Row<'CloudSandbox'> | null
    pendingVcpus?: number | undefined
  }): Promise<PodLaunchOutcome> {
    const { thread, existing, pendingVcpus } = args
    const session = await sessionOfThread({ reader: db, threadId: thread.id })
    if (session.executionLocation === null) {
      await db.orm.public.Session.where({ id: session.id }).update({ executionLocation: 'cloud' })
    }
    const gap = await this.credentialsOf({ userId: thread.userId })
    if (gap !== null) {
      await this.reportGap({ threadId: thread.id, failure: gap })
      await this.signals.podChanged({ threadId: thread.id })
      return { reply: notConfiguredReplyOf(gap), dispatchFailed: false }
    }
    const booting = { state: ESandboxProvisionState.Booting }
    const claim = await this.claim({ thread, existing, pendingVcpus })
    if (claim === null) return { reply: booting, dispatchFailed: false }
    await this.signals.podChanged({ threadId: thread.id })
    const dispatched = await this.dispatch({ threadId: thread.id, claim })
    return { reply: booting, dispatchFailed: !dispatched }
  }

  async dispatchClaimed(args: { thread: Row<'Thread'>; claim: RowClaim }): Promise<boolean> {
    const { thread, claim } = args
    const session = await sessionOfThread({ reader: db, threadId: thread.id })
    if (session.executionLocation === null) {
      await db.orm.public.Session.where({ id: session.id }).update({ executionLocation: 'cloud' })
    }
    await this.signals.podChanged({ threadId: thread.id })
    return this.dispatch({ threadId: thread.id, claim })
  }

  async rollover(args: { threadId: string; sessionId: string }): Promise<{ dispatched: boolean }> {
    const { threadId, sessionId } = args
    const thread = await db.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const podSessionId = await podSessionOf({ reader: db, threadId })
    const existing = await db.orm.public.CloudSandbox.first({ sessionId: podSessionId })
    if (existing === null) throw new NotFoundException('this thread has no pod to roll over')
    const claim = await this.claim({ thread, existing })
    if (claim === null) return { dispatched: false }
    await this.signals.podChanged({ threadId })
    const dispatched = await this.dispatch({ threadId, claim, stopSessionId: sessionId })
    if (!dispatched) throw dispatchFailure()
    return { dispatched: true }
  }

  private async recordDispatchFailure(args: { threadId: string; claim: RowClaim }): Promise<void> {
    try {
      await markFailed({ threadId: args.threadId, wakeClaim: args.claim.wakeClaim })
      await recordBootSteps({
        threadId: args.threadId,
        steps: [
          {
            step: EBootStep.Provision,
            state: EBootStepState.Error,
            error: DISPATCH_FAILED_MESSAGE,
          },
        ],
      })
      await this.signals.podChanged({ threadId: args.threadId })
    } catch (failure) {
      this.logger.warn(
        `recording the dispatch failure of thread ${args.threadId} failed: ${failureText(failure)}`,
      )
    }
  }
}

export const dispatchFailure = (): BadGatewayException =>
  new BadGatewayException(DISPATCH_FAILED_MESSAGE)
