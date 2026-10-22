import { describe, expect, it } from 'bun:test'

import {
  NOTHING_BILLED,
  TelemetryPort,
  type TelemetryTurn,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { recordTurnSpend, TURN_CRASHED } from '../record-turn-spend'
import { TurnLedgerPort, type TurnSpend } from '../turn-ledger.port'

class RecordingTelemetry extends TelemetryPort {
  turns: TelemetryTurn[] = []
  exceptions: { kind: string; messageClass: string }[] = []

  turnCompleted(turn: TelemetryTurn): void {
    this.turns.push(turn)
  }

  exception(args: { kind: string; messageClass: string }): void {
    this.exceptions.push(args)
  }

  featureUsed(): void {}
  toolDenied(): void {}
  agentSpawned(): void {}
  agentEnded(): void {}
  async flush(): Promise<void> {}
}

class CapturingLedger extends TurnLedgerPort {
  recorded: TurnSpend[] = []

  async record(spend: TurnSpend): Promise<void> {
    this.recorded.push(spend)
  }

  async forThread(): Promise<TurnSpend[]> {
    return this.recorded
  }

  async forThreadTree(): Promise<{ own: readonly TurnSpend[]; delegated: readonly TurnSpend[] }> {
    return { own: this.recorded, delegated: [] }
  }
}

const base = {
  threadId: 'brn_1' as ThreadId,
  runId: 'run_1' as RunId,
  model: { id: 'anthropic', modelId: 'claude-opus-4-1' },
  steps: 3,
  usage: { ...NOTHING_BILLED, inputTokens: 1200, outputTokens: 300 },
  startedAt: '2026-09-29T10:00:00.000Z',
  endedAt: '2026-09-29T10:00:05.000Z',
}

describe('recordTurnSpend telemetry', () => {
  it('emits a turn rollup after the ledger records', async () => {
    const ledger = new CapturingLedger()
    const telemetry = new RecordingTelemetry()

    await recordTurnSpend({ ...base, status: 'completed', ledger, telemetry })

    expect(ledger.recorded).toHaveLength(1)
    expect(telemetry.turns).toEqual([
      {
        status: 'completed',
        providerId: 'anthropic',
        modelId: 'claude-opus-4-1',
        steps: 3,
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 5000,
      },
    ])
    expect(telemetry.exceptions).toEqual([])
  })

  it('emits an exception alongside the rollup when the turn crashed', async () => {
    const ledger = new CapturingLedger()
    const telemetry = new RecordingTelemetry()

    await recordTurnSpend({ ...base, status: TURN_CRASHED, ledger, telemetry })

    expect(telemetry.turns).toHaveLength(1)
    expect(telemetry.exceptions).toEqual([{ kind: 'turn-crashed', messageClass: 'crashed' }])
  })

  it('skips telemetry for a zero-step non-crash turn, matching the ledger', async () => {
    const ledger = new CapturingLedger()
    const telemetry = new RecordingTelemetry()

    await recordTurnSpend({ ...base, status: 'idle', steps: 0, ledger, telemetry })

    expect(ledger.recorded).toHaveLength(0)
    expect(telemetry.turns).toHaveLength(0)
  })

  it('still records when no telemetry port is present', async () => {
    const ledger = new CapturingLedger()

    await recordTurnSpend({ ...base, status: 'completed', ledger })

    expect(ledger.recorded).toHaveLength(1)
  })
})
