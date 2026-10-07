import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EQualityImpact } from '@dltech/atlas-core'

import { handleEfficacyCommand } from '../../src/efficacy-cli'
import { ECaseReviewState } from '../../src/case'
import { sha256Hex } from '../../src/hash'
import { DATASET_MANIFEST_SCHEMA_VERSION, EDatasetSplit } from '../../src/manifest'
import { ERunMode, ERunStatus } from '../../src/results'
import { RUN_MANIFEST_SCHEMA_VERSION } from '../../src/run-plan'
import { makeTmpDir } from '../../__fixtures__/curation'
import { assess, decided, judgmentFor, makeCase, MODEL, rowOf } from './efficacy-fixtures'

const created: string[] = []
afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

async function scenario({ datasetHash, resolved = MODEL }: { datasetHash?: string; resolved?: string } = {}) {
  const root = await makeTmpDir()
  created.push(root)
  const positive = makeCase({ id: 'c1', expected: decided({ impact: EQualityImpact.Introduced, concern: true, evidenceIds: ['m1'] }) })
  const negative = makeCase({ id: 'c2', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
  const casesText = `${[positive, negative].map((evalCase) => JSON.stringify({ ...evalCase, review: { state: ECaseReviewState.Accepted, verifications: [] } })).join('\n')}\n`
  const manifest = {
    schemaVersion: DATASET_MANIFEST_SCHEMA_VERSION,
    featureId: positive.featureId,
    inputSchemaVersion: '1',
    expectedSchemaVersion: '1',
    rubricVersion: '1',
    datasetVersion: 'pilot-1',
    casesFile: 'cases.jsonl',
    contentHash: sha256Hex({ text: casesText }),
    split: EDatasetSplit.Development,
    caseIds: ['c1', 'c2'],
    counts: { accepted: 2, rejected: 0 },
    metricGates: [],
  }
  const dataset = join(root, 'dataset')
  await mkdir(dataset)
  await writeFile(join(dataset, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(dataset, 'cases.jsonl'), casesText)
  const judgments = join(root, 'judgments.jsonl')
  await writeFile(judgments, `${[judgmentFor({ evalCase: positive, warranted: true }), judgmentFor({ evalCase: negative, warranted: false })].map((entry) => JSON.stringify(entry)).join('\n')}\n`)
  const run = join(root, 'run')
  await mkdir(run)
  const planned = [positive, negative].flatMap((evalCase) => [1, 2].map((trial) => ({ caseId: evalCase.id, trialId: `trial-${trial}`, variantId: 'default' })))
  await writeFile(join(run, 'invocation.manifest.json'), JSON.stringify({
    schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    invocationId: 'inv-1',
    featureId: positive.featureId,
    mode: ERunMode.Live,
    dataset: { version: 'pilot-1', hash: datasetHash ?? manifest.contentHash, path: join(dataset, 'manifest.json') },
    model: { requested: MODEL, promotable: true },
    planned: { uniqueCases: 2, trialsPerCase: 2, variants: ['default'], rows: planned },
  }))
  await writeFile(join(run, 'summary.json'), JSON.stringify({
    status: ERunStatus.Complete, invocationId: 'inv-1', featureId: positive.featureId, datasetVersion: 'pilot-1', datasetHash: datasetHash ?? manifest.contentHash, mode: ERunMode.Live,
    model: { requested: MODEL, resolved: MODEL },
    enabledPolicyIds: ['single-responsibility'], batchMode: 'batched', metrics: [], failureNotes: [],
  }))
  const rows = planned.map((identity) => {
    const evalCase = identity.caseId === 'c1' ? positive : negative
    const assessment = evalCase === positive
      ? assess({ evalCase, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm1' })
      : assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged })
    return JSON.stringify(rowOf({ evalCase, assessment, trialId: identity.trialId, model: resolved }))
  })
  await writeFile(join(run, 'results.jsonl'), `${rows.join('\n')}\n`)
  const argv = (output: string): readonly string[] => ['--run', run, '--dataset', join(dataset, 'manifest.json'), '--judgments', judgments, '--output-dir', output]
  return { root, run, argv }
}

describe('efficacy report CLI', () => {
  test('writes report.json and report.txt into a fresh directory and never touches the run', async () => {
    const { root, run, argv } = await scenario()
    const before = await readdir(run)
    const output = join(root, 'report')
    const code = await handleEfficacyCommand({ argv: argv(output) })
    expect(code).toBe(0)
    expect((await readdir(output)).sort()).toEqual(['report.json', 'report.txt'])
    expect(await readdir(run)).toEqual(before)
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))
    expect(report.promotable).toBe(false)
    expect(report.rows.planned).toBe(4)
    expect(report.notification.confusion.tp).toBe(2)
    const text = await readFile(join(output, 'report.txt'), 'utf8')
    expect(text).toContain('not promotable')
    expect(text).toContain('notification precision 2/2')
  })

  test('labels fake execution explicitly rather than presenting it as live efficacy', async () => {
    const { root, run, argv } = await scenario()
    for (const file of ['invocation.manifest.json', 'summary.json']) {
      const path = join(run, file)
      const value = JSON.parse(await readFile(path, 'utf8'))
      await writeFile(path, JSON.stringify({ ...value, mode: ERunMode.Fake }))
    }
    const output = join(root, 'report')
    await handleEfficacyCommand({ argv: argv(output) })
    expect(await readFile(join(output, 'report.txt'), 'utf8')).toContain('fake execution; not live efficacy')
  })

  test('refuses an output directory that already exists', async () => {
    const { root, argv } = await scenario()
    const output = join(root, 'taken')
    await mkdir(output)
    await expect(handleEfficacyCommand({ argv: argv(output) })).rejects.toThrow('already exists')
    expect(await readdir(output)).toEqual([])
  })

  test('refuses an output directory inside the run directory', async () => {
    const { run, argv } = await scenario()
    await expect(handleEfficacyCommand({ argv: argv(join(run, 'report')) })).rejects.toThrow('inside the run')
  })

  test('rejects a run whose dataset hash differs from the supplied dataset', async () => {
    const { root, argv } = await scenario({ datasetHash: 'f'.repeat(64) })
    const output = join(root, 'report')
    await expect(handleEfficacyCommand({ argv: argv(output) })).rejects.toThrow('dataset hash')
    await expect(stat(output)).rejects.toThrow()
  })

  test('a row resolved to a different model is reported as an operational failure and blocks', async () => {
    const { root, argv } = await scenario({ resolved: 'impostor' })
    const output = join(root, 'report')
    const code = await handleEfficacyCommand({ argv: argv(output) })
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))
    expect(report.rows.operational.byReason).toEqual({ model_identity: 4 })
    expect(code).toBe(1)
  })
})
