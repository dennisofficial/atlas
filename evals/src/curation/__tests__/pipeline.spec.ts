import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { JEV_QUALITY_MODEL, EQualityImpact, EQualityReviewStatus, EQualityScopeKind } from '@dltech/atlas-core'

import { createFakeTransport } from '../../../__fixtures__/fake-transport'
import { counterAfter, counterBefore, makeTmpDir, recordCapture } from '../../../__fixtures__/curation'
import { codeQualityFeature } from '../../registry-default'
import { enabledEvalPolicyIds, resolveEvalPolicies } from '../../../code-quality/policies'
import { runCodeQualityTask } from '../../../code-quality/task'
import { createDecisionCaller } from '../../../code-quality/transport'
import { writeFileAtomic } from '../../atomic'
import { loadDataset } from '../../dataset-io'
import { handleCurationCommand } from '../../curation-cli'
import { ERunMode } from '../../results'
import { EVerificationOutcome } from '../../case'
import { ESrpExpectationKind } from '../../../code-quality/expected'

const created: string[] = []

afterEach(async () => {
  for (const dir of created.splice(0)) await rm(dir, { recursive: true, force: true })
})

const tmpDir = async (): Promise<string> => {
  const dir = await makeTmpDir()
  created.push(dir)
  return dir
}

const jsonl = (rows: readonly unknown[]): string => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`

describe('QualityExampleSink -> export -> curate -> verified labels -> golden input -> eval task', () => {
  test('full pipeline over named temp session directories with no network', async () => {
    const sessionDir = await tmpDir()
    const work = await tmpDir()
    await recordCapture({ sessionDir, before: counterBefore(), after: counterAfter() })

    const exportDir = join(work, 'export')
    expect(await handleCurationCommand({ command: 'export-examples', argv: ['--session-dir', sessionDir, '--output-dir', exportDir] })).toBe(0)
    const candidatesDir = join(work, 'candidates')
    expect(await handleCurationCommand({ command: 'curate', argv: ['--export-dir', exportDir, '--output-dir', candidatesDir] })).toBe(0)

    const candidateLines = (await readFile(join(candidatesDir, 'candidates.jsonl'), 'utf8')).trim().split('\n')
    expect(candidateLines).toHaveLength(1)
    const candidate = JSON.parse(candidateLines[0] ?? '')
    expect(candidate.snapshot.scope.name).toBe('Counter')
    const evidenceId: string = candidate.snapshot.scope.evidence.find((entry: { label: string }) => entry.label === 'describe').id

    const expected = {
      kind: ESrpExpectationKind.Decided,
      fields: { impact: EQualityImpact.Introduced, currentConcern: true, evidenceIds: [evidenceId] },
    }
    const labelsPath = join(work, 'drafts.jsonl')
    const verificationPath = join(work, 'checks.jsonl')
    await writeFileAtomic({
      path: labelsPath,
      content: jsonl([{ candidateId: candidate.candidateId, expected, generator: 'drafter', generatedAt: '2026-10-06T00:00:00Z' }]),
    })
    await writeFileAtomic({
      path: verificationPath,
      content: jsonl([{ candidateId: candidate.candidateId, verifier: 'reviewer', verifiedAt: '2026-10-06T01:00:00Z', outcome: EVerificationOutcome.Confirmed }]),
    })
    const goldenDir = join(work, 'golden')
    const code = await handleCurationCommand({
      command: 'label-review',
      argv: ['--candidates', join(candidatesDir, 'candidates.jsonl'), '--labels', labelsPath, '--verification', verificationPath, '--output-dir', goldenDir, '--dataset-version', 'pipeline-1'],
    })
    expect(code).toBe(0)

    const loaded = await loadDataset({ feature: codeQualityFeature, datasetPath: join(goldenDir, 'manifest.json'), suite: codeQualityFeature.id })
    expect(loaded.cases).toHaveLength(1)
    const evalCase = loaded.cases[0]
    if (evalCase === undefined) throw new Error('no golden case')
    expect(evalCase.provenance.completeness).toBe('captured-scope')
    const input = codeQualityFeature.inputSchema.parse(evalCase.input) as Parameters<typeof runCodeQualityTask>[0]['input']
    expect(input.policyIds).toEqual(enabledEvalPolicyIds)
    expect(input.scope.kind).toBe(EQualityScopeKind.Class)
    expect(input.scope.after).toStartWith('export class Counter')
    expect(input.scope.evidence.map((entry) => entry.id)).toContain(evidenceId)

    const transport = createFakeTransport({
      rules: [
        {
          answers: {
            'single-responsibility:currentConcern': { noul: 0.9 },
            'single-responsibility:impact': { choice: EQualityImpact.Introduced, probabilities: { [EQualityImpact.Introduced]: 0.9 } },
            'single-responsibility:focus': { choice: evidenceId, probabilities: { [evidenceId]: 0.9 } },
          },
        },
      ],
    })
    const output = await runCodeQualityTask({
      input,
      model: JEV_QUALITY_MODEL,
      deadlineMs: 1000,
      deps: { decide: createDecisionCaller({ mode: ERunMode.Fake, fakeSystemOne: transport.systemOne }), resolvePolicies: resolveEvalPolicies },
    })
    expect(output.assessments[0]?.status).toBe(EQualityReviewStatus.Completed)
    expect(output.assessments[0]?.evidenceIds).toEqual([evidenceId])
    expect(transport.calls).toHaveLength(1)
    expect(JSON.parse(transport.calls[0]?.state ?? '{}').scope.after).toBe(input.scope.after)
  })

  test('rejects a candidate whose stored diff was edited after export', async () => {
    const sessionDir = await tmpDir()
    const work = await tmpDir()
    await recordCapture({ sessionDir, before: counterBefore(), after: counterAfter() })
    const exportDir = join(work, 'export')
    await handleCurationCommand({ command: 'export-examples', argv: ['--session-dir', sessionDir, '--output-dir', exportDir] })
    const candidatesDir = join(work, 'candidates')
    await handleCurationCommand({ command: 'curate', argv: ['--export-dir', exportDir, '--output-dir', candidatesDir] })
    const path = join(candidatesDir, 'candidates.jsonl')
    const candidate = JSON.parse((await readFile(path, 'utf8')).trim())
    candidate.snapshot.scope.diff = `${candidate.snapshot.scope.diff}+injected\n`
    await writeFileAtomic({ path, content: jsonl([candidate]) })
    const { scopeFromCandidate } = await import('../../../code-quality/input-builder')
    const { readCandidatesFile } = await import('../label-review-io')
    const [reread] = await readCandidatesFile({ path })
    if (reread === undefined) throw new Error('no candidate')
    expect(() => scopeFromCandidate({ candidate: reread })).toThrow('diff does not match')
  })
})
