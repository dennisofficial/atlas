import { toRunId, toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { ThreadTreeSpend, TurnSpend } from '../ledger/turn-ledger.port'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { EClientRequest, readTurnsReplySchema } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'
import type { WireTurn } from './session-wire'

const spendFromWire = (wire: WireTurn): TurnSpend => ({
  runId: toRunId(wire.runId),
  threadId: toThreadId(wire.threadId),
  status: wire.status,
  providerId: wire.providerId,
  modelId: wire.modelId,
  steps: wire.steps,
  inputTokens: wire.inputTokens,
  outputTokens: wire.outputTokens,
  cacheReadTokens: wire.cacheReadTokens,
  cacheWriteTokens: wire.cacheWriteTokens,
  startedAt: wire.startedAt,
  endedAt: wire.endedAt,
  durationMs: wire.durationMs,
})

/**
 * The cloud transcript's turn-spend read half, answered by the sandbox's serve from its on-disk
 * ledger. Recording refuses — the loop inside the sandbox writes spend as turns settle.
 */
export class RemoteTurnLedger extends TurnLedgerPort {
  private readonly channel: Pick<RemoteDeltaChannel, 'request'>

  constructor(args: { channel: Pick<RemoteDeltaChannel, 'request'> }) {
    super()
    this.channel = args.channel
  }

  record(_spend: TurnSpend): Promise<void> {
    return Promise.reject(
      new Error('the sandbox owns the turn ledger while lifted — reads only over the channel'),
    )
  }

  async forThread(args: { threadId: ThreadId }): Promise<TurnSpend[]> {
    return [...(await this.tree(args)).own]
  }

  async forThreadTree(args: { threadId: ThreadId }): Promise<ThreadTreeSpend> {
    return await this.tree(args)
  }

  private async tree(args: { threadId: ThreadId }): Promise<ThreadTreeSpend> {
    const reply = readTurnsReplySchema.parse(
      await this.channel.request({
        op: EClientRequest.ReadTurns,
        params: { threadId: args.threadId },
      }),
    )
    return {
      own: reply.own.map(spendFromWire),
      delegated: reply.delegated.map(spendFromWire),
    }
  }
}
