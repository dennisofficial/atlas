import { toRunId, toThreadId } from '@dltech/atlas-core'
import { z } from 'zod'

import type { TurnSpend } from '../turn-ledger.port'

export const LEDGER_LINE_VERSION = 1

export class LedgerFromNewerAtlasError extends Error {
  constructor(args: { version: number }) {
    super(
      `ledger line was written by a newer Atlas (v${args.version}, this build reads v${LEDGER_LINE_VERSION}); upgrade before opening this session`,
    )
    this.name = 'LedgerFromNewerAtlasError'
  }
}

const ledgerLineSchema = z.object({
  v: z.number().optional().default(LEDGER_LINE_VERSION),
  runId: z.string(),
  threadId: z.string(),
  status: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  steps: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number(),
})

export function encodeLedgerLine({ spend }: { spend: TurnSpend }): string {
  return JSON.stringify({ v: LEDGER_LINE_VERSION, ...spend })
}

export function parseLedgerLines({ text }: { text: string }): TurnSpend[] {
  const byRunId = new Map<string, TurnSpend>()
  const segments = text.split('\n')
  const last = segments.length - 1

  for (const [index, raw] of segments.entries()) {
    if (raw === '') continue
    const decoded = decodeLedgerLine({ raw })
    if (decoded === undefined) {
      if (index === last) break
      continue
    }
    byRunId.set(decoded.runId, decoded)
  }
  return [...byRunId.values()]
}

function decodeLedgerLine({ raw }: { raw: string }): TurnSpend | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const version = ledgerVersionOf({ parsed })
  if (version > LEDGER_LINE_VERSION) throw new LedgerFromNewerAtlasError({ version })
  const line = ledgerLineSchema.safeParse(parsed)
  if (!line.success) return undefined
  const { v: _v, ...spend } = line.data
  return { ...spend, runId: toRunId(spend.runId), threadId: toThreadId(spend.threadId) }
}

function ledgerVersionOf({ parsed }: { parsed: unknown }): number {
  if (typeof parsed !== 'object' || parsed === null) return LEDGER_LINE_VERSION
  const v = (parsed as { v?: unknown }).v
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : LEDGER_LINE_VERSION
}
