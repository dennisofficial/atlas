import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EQualityImpact } from '@dltech/atlas-core'

import { ESrpExpectationKind } from '../code-quality/expected'
import { EVerificationOutcome } from '../src/case'
import { writeFileAtomic } from '../src/atomic'
import { handleCurationCommand } from '../src/curation-cli'
import { counterAfter, counterBefore, recordCapture } from './curation'

const jsonl = (rows: readonly unknown[]): string => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`

export type GoldenPipeline = { goldenManifest: string; candidatesDir: string; candidateId: string; evidenceId: string }

export async function runGoldenPipeline({ sessionDir, work }: { sessionDir: string; work: string }): Promise<GoldenPipeline> {
  await recordCapture({ sessionDir, before: counterBefore(), after: counterAfter() })
  const exportDir = join(work, 'export')
  const candidatesDir = join(work, 'candidates')
  const goldenDir = join(work, 'golden')
  await handleCurationCommand({ command: 'export-examples', argv: ['--session-dir', sessionDir, '--output-dir', exportDir] })
  await handleCurationCommand({ command: 'curate', argv: ['--export-dir', exportDir, '--output-dir', candidatesDir] })
  const candidate = JSON.parse((await readFile(join(candidatesDir, 'candidates.jsonl'), 'utf8')).trim())
  const evidenceId: string = candidate.snapshot.scope.evidence.find((entry: { label: string }) => entry.label === 'describe').id
  const expected = { kind: ESrpExpectationKind.Decided, fields: { impact: EQualityImpact.Introduced, currentConcern: true, evidenceIds: [evidenceId] } }
  const labelsPath = join(work, 'drafts.jsonl')
  const verificationPath = join(work, 'checks.jsonl')
  await writeFileAtomic({ path: labelsPath, content: jsonl([{ candidateId: candidate.candidateId, expected, generator: 'drafter', generatedAt: '2026-10-06T00:00:00Z' }]) })
  await writeFileAtomic({
    path: verificationPath,
    content: jsonl([{ candidateId: candidate.candidateId, verifier: 'reviewer', verifiedAt: '2026-10-06T01:00:00Z', outcome: EVerificationOutcome.Confirmed }]),
  })
  await handleCurationCommand({
    command: 'label-review',
    argv: ['--candidates', join(candidatesDir, 'candidates.jsonl'), '--labels', labelsPath, '--verification', verificationPath, '--output-dir', goldenDir, '--dataset-version', 'pipeline-1'],
  })
  return { goldenManifest: join(goldenDir, 'manifest.json'), candidatesDir, candidateId: candidate.candidateId, evidenceId }
}
