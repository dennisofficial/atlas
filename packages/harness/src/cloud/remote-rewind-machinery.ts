import {
  ENoticeTone,
  NOTICE_WARN_MS,
  type NoticePort,
  type RewindCut,
  type ThreadId,
} from '@dltech/atlas-core'
import { rewindApplyParamsSchema, type RewindApplyParams, type RewindCutWire } from '@dltech/atlas-wire'

import { EClientRequest } from './channel-wire'
import { RewindMachineryPort, type RewindRead } from '../store/rewind-machinery'
import type { RewindKill } from '../store/rewind'

const cutWireOf = (cut: RewindCut): RewindCutWire => {
  if (cut.kind === 'agent') {
    return { kind: cut.kind, agentId: cut.agentId, agentType: cut.agentType, intent: cut.intent }
  }
  if (cut.kind === 'shell') {
    return {
      kind: cut.kind,
      shellId: cut.shellId,
      ...(cut.command === undefined ? {} : { command: cut.command }),
      ...(cut.description === undefined ? {} : { description: cut.description }),
    }
  }
  return {
    kind: cut.kind,
    serviceId: cut.serviceId,
    ...(cut.command === undefined ? {} : { command: cut.command }),
    ...(cut.description === undefined ? {} : { description: cut.description }),
  }
}

const unreachableKill = (cut: RewindCut): RewindKill => {
  if (cut.kind === 'agent') {
    return {
      kind: 'agent',
      agentId: cut.agentId,
      agentType: cut.agentType,
      intent: cut.intent,
      running: false,
    }
  }
  if (cut.kind === 'shell') {
    return {
      kind: 'shell',
      shellId: cut.shellId,
      command: cut.command,
      description: cut.description,
      running: false,
    }
  }
  return {
    kind: 'service',
    serviceId: cut.serviceId,
    command: cut.command,
    description: cut.description,
    running: false,
  }
}

/**
 * The channel as a rewind needs it: pricing the confirmation is the roster's job (the cloud app's
 * registries already read it), so this port is the command half only. `apply` both destroys the
 * named creations and stops the turn the sandbox is driving, so a mid-turn loop never acts on
 * pre-rewind state.
 */
export type ChannelRewindPort = {
  apply(args: { threadId: ThreadId; cuts: readonly RewindCut[] }): Promise<void>
}

const REWIND_APPLY_NOTICE_KEY = 'cloud:rewind-apply'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const cutNameOf = (cut: RewindCut): string => {
  if (cut.kind === 'agent') return `agent ${cut.agentType} (“${cut.intent}”)`
  if (cut.kind === 'shell') return `shell ${cut.shellId}`
  return `service ${cut.serviceId}`
}

export class RemoteRewindMachinery extends RewindMachineryPort {
  private readonly channel: ChannelRewindPort
  private readonly notice: NoticePort | undefined
  private readonly read: (args: {
    cuts: readonly RewindCut[]
    threadId: ThreadId
  }) => Promise<RewindRead>

  constructor(args: {
    channel: ChannelRewindPort
    read: (args: { cuts: readonly RewindCut[]; threadId: ThreadId }) => Promise<RewindRead>
    notice?: NoticePort | undefined
  }) {
    super()
    this.channel = args.channel
    this.read = args.read
    this.notice = args.notice
  }

  /**
   * The read is the cloud session's roster-backed registries; when it fails the cut list still
   * stands (it comes from the log) with liveness unknown.
   */
  async snapshot(args: { cuts: readonly RewindCut[]; threadId: ThreadId }): Promise<RewindRead> {
    try {
      return await this.read(args)
    } catch {
      return { reachable: false, kills: args.cuts.map(unreachableKill) }
    }
  }

  /**
   * A channel that cannot carry the apply degrades to the rewind that always landed: the HTTP
   * write still truncates the log, and the sandbox's cut processes keep running — exactly what a
   * serve too old to answer the op does today. It used to do so silently; the operator now hears
   * what may still be running on the far side.
   */
  async destroy(args: { cuts: readonly RewindCut[]; threadId: ThreadId }): Promise<void> {
    await this.channel.apply(args).catch((error: unknown) => {
      this.notice?.notify({
        key: REWIND_APPLY_NOTICE_KEY,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `the sandbox refused the rewind cleanup (${messageOf(error)}) — ${args.cuts.map(cutNameOf).join(', ')} may still be running in the cloud sandbox. The rewind itself landed.`,
      })
    })
  }
}

export const rewindApplyParamsOf = (args: {
  threadId: ThreadId
  cuts: readonly RewindCut[]
}): RewindApplyParams =>
  rewindApplyParamsSchema.parse({ threadId: args.threadId, cuts: args.cuts.map(cutWireOf) })

export const REWIND_REQUEST_OP = EClientRequest.Rewind
