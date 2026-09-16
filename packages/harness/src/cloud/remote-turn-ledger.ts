import { toRunId, toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { ThreadTreeSpend, TurnSpend } from '../ledger/turn-ledger.port'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { SessionsClient } from './sessions-client'
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

export class RemoteTurnLedger extends TurnLedgerPort {
  private readonly client: SessionsClient

  constructor(args: { client: SessionsClient }) {
    super()
    this.client = args.client
  }

  async record(spend: TurnSpend): Promise<void> {
    const { runId, threadId, ...rest } = spend
    await this.client.recordTurn({ threadId, runId, spend: rest })
  }

  async forThread(args: { threadId: ThreadId }): Promise<TurnSpend[]> {
    const wire = await this.client.turnsForThread({ threadId: args.threadId })
    return wire.map(spendFromWire)
  }

  async forThreadTree(args: { threadId: ThreadId }): Promise<ThreadTreeSpend> {
    const wire = await this.client.turnTree({ threadId: args.threadId })
    return {
      own: wire.own.map(spendFromWire),
      delegated: wire.delegated.map(spendFromWire),
    }
  }
}
