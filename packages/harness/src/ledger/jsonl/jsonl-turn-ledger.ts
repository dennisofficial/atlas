import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'

import { ledgerFile, sessionDirectory } from '../../store/sessions/paths'
import type { SessionRegistry } from '../../store/sessions/registry'
import type { ThreadTreeSpend, TurnLedgerPort, TurnSpend } from '../turn-ledger.port'
import { encodeLedgerLine, parseLedgerLines } from './ledger-lines'
import { readSessionSpawnedThreadIds } from './session-threads'

export type SessionSpendTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export class JsonlTurnLedger implements TurnLedgerPort {
  private readonly home: string
  private readonly registry: SessionRegistry

  constructor(args: { home: string; registry: SessionRegistry }) {
    this.home = args.home
    this.registry = args.registry
  }

  async record(spend: TurnSpend): Promise<void> {
    const sessionDir = await this.sessionDirFor({ threadId: spend.threadId })
    const handle = this.registry.handleFor({ sessionDir })
    await this.registry.enqueue({
      handle,
      run: async () => {
        const file = ledgerFile({ sessionDir })
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, `${encodeLedgerLine({ spend })}\n`, 'utf8')
      },
    })
  }

  async forThread({ threadId }: { threadId: ThreadId }): Promise<TurnSpend[]> {
    const turns = await this.readSessionTurns({ threadId })
    return turns.filter((turn) => turn.threadId === threadId).sort(byStartedAt)
  }

  async forThreadTree({ threadId }: { threadId: ThreadId }): Promise<ThreadTreeSpend> {
    const sessionDir = await this.sessionDirFor({ threadId })
    const spawned = await readSessionSpawnedThreadIds({ sessionDir, threadId })
    const delegatedIds = new Set<string>(spawned)
    const turns = (await readLedgerTurns({ file: ledgerFile({ sessionDir }) }))
      .filter((turn) => turn.threadId === threadId || delegatedIds.has(turn.threadId))
      .sort(byStartedAtThenRunId)

    const own: TurnSpend[] = []
    const delegated: TurnSpend[] = []
    for (const turn of turns) {
      if (turn.threadId === threadId) own.push(turn)
      else delegated.push(turn)
    }
    return { own, delegated }
  }

  private async sessionDirFor({ threadId }: { threadId: ThreadId }): Promise<string> {
    const resolved = await this.registry.sessionDirOf({ threadId })
    if (resolved !== undefined) return resolved
    return sessionDirectory({ home: this.home, sessionId: threadId })
  }

  private async readSessionTurns({ threadId }: { threadId: ThreadId }): Promise<TurnSpend[]> {
    const sessionDir = await this.sessionDirFor({ threadId })
    return readLedgerTurns({ file: ledgerFile({ sessionDir }) })
  }
}

export async function sumSessionSpend({
  sessionDir,
}: {
  sessionDir: string
}): Promise<SessionSpendTotals> {
  const turns = await readLedgerTurns({ file: ledgerFile({ sessionDir }) })
  const totals: SessionSpendTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  for (const turn of turns) {
    totals.inputTokens += turn.inputTokens
    totals.outputTokens += turn.outputTokens
    totals.cacheReadTokens += turn.cacheReadTokens
    totals.cacheWriteTokens += turn.cacheWriteTokens
  }
  return totals
}

async function readLedgerTurns({ file }: { file: string }): Promise<TurnSpend[]> {
  const text = await readFile(file, 'utf8').catch(() => '')
  return parseLedgerLines({ text })
}

function byStartedAt(left: TurnSpend, right: TurnSpend): number {
  return left.startedAt.localeCompare(right.startedAt)
}

function byStartedAtThenRunId(left: TurnSpend, right: TurnSpend): number {
  const started = byStartedAt(left, right)
  if (started !== 0) return started
  return left.runId.localeCompare(right.runId)
}
