import { toRunId, toThreadId } from '@dltech/atlas-core'
import { z } from 'zod'

import type { TurnSpend } from '../turn-ledger.port'

const ledgerLineSchema = z.object({
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
  return JSON.stringify(spend)
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
  const line = ledgerLineSchema.safeParse(parsed)
  if (!line.success) return undefined
  return { ...line.data, runId: toRunId(line.data.runId), threadId: toThreadId(line.data.threadId) }
}
