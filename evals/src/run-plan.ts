import type { EvalCase } from './case'
import type { ERunMode } from './results'
import { sha256Hex } from './hash'

export const RUN_MANIFEST_SCHEMA_VERSION = 1

export type PlannedRow = { caseId: string; trialId: string; variantId: string }

export type RunManifest = {
  schemaVersion: typeof RUN_MANIFEST_SCHEMA_VERSION
  invocationId: string
  featureId: string
  mode: ERunMode
  dataset: { version: string; hash: string; path: string }
  code: { adapterDigest: string; supervisorDigest: string }
  model: { requested: string; promotable: boolean }
  enabledPolicyIds: readonly string[]
  batchMode: 'batched' | 'per-policy-split'
  planned: { uniqueCases: number; trialsPerCase: number; variants: readonly string[]; rows: readonly PlannedRow[] }
  deadlineMs: number
  concurrency: number
  cacheDisabled: boolean
  startedAt: string
}

export function expandPlan({ cases, trials }: { cases: readonly EvalCase[]; trials: number }): {
  rows: readonly PlannedRow[]
  variants: readonly string[]
} {
  const variants = ['default']
  const rows: PlannedRow[] = []
  for (const evalCase of cases) {
    for (let trial = 1; trial <= trials; trial += 1) {
      for (const variantId of variants) {
        rows.push({ caseId: evalCase.id, trialId: `trial-${trial}`, variantId })
      }
    }
  }
  return { rows, variants }
}

export function sourceDigestOf({ parts }: { parts: readonly string[] }): string {
  return sha256Hex({ text: parts.join('\0') })
}
