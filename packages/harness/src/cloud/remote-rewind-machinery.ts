import {
  rewindApplyParamsSchema,
  type RewindCut,
  type RewindCutWire,
  type ThreadId,
  type RewindApplyParams,
} from '@dltech/atlas-core'

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

export class RemoteRewindMachinery extends RewindMachineryPort {
  private readonly channel: ChannelRewindPort
  private readonly read: (args: {
    cuts: readonly RewindCut[]
    threadId: ThreadId
  }) => Promise<RewindRead>

  constructor(args: {
    channel: ChannelRewindPort
    read: (args: { cuts: readonly RewindCut[]; threadId: ThreadId }) => Promise<RewindRead>
  }) {
    super()
    this.channel = args.channel
    this.read = args.read
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
   * serve too old to answer the op does today.
   */
  async destroy(args: { cuts: readonly RewindCut[]; threadId: ThreadId }): Promise<void> {
    await this.channel.apply(args).catch(() => undefined)
  }
}

export const rewindApplyParamsOf = (args: {
  threadId: ThreadId
  cuts: readonly RewindCut[]
}): RewindApplyParams =>
  rewindApplyParamsSchema.parse({ threadId: args.threadId, cuts: args.cuts.map(cutWireOf) })

export const REWIND_REQUEST_OP = EClientRequest.Rewind
