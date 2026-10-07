import { ArgParseError, parseArgs, requireValue } from './args'
import { EDatasetSplit } from './manifest'
import { resolveSuiteId } from './registry-default'
import { defaultExportDeps } from './curation/inventory'
import { reparseScope } from './curation/reparse-scope'

const EXPORT_SPEC = { '--session-dir': 'value', '--output-dir': 'value' } as const
const CURATE_SPEC = { '--export-dir': 'value', '--output-dir': 'value' } as const
const LABEL_REVIEW_SPEC = {
  '--candidates': 'value',
  '--labels': 'value',
  '--verification': 'value',
  '--output-dir': 'value',
  '--feature': 'value',
  '--dataset-version': 'value',
  '--split': 'value',
} as const
const HISTORY_SPEC = { '--session-dir': 'value', '--output-dir': 'value' } as const

async function handleImportHistory({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: HISTORY_SPEC })
  const sessionDirs = args.lists['--session-dir'] ?? []
  if (sessionDirs.length === 0) throw new ArgParseError('import-history requires at least one --session-dir')
  const outputDir = requireValue({ args, key: '--output-dir' })
  const { importHistoricalSessions } = await import('./curation/historical-import')
  const report = await importHistoricalSessions({ sessionDirs, outputDir })
  console.log(`history: ${report.changes} changes, ${report.rejections} rejections across ${report.logs} logs -> ${report.outputDir}`)
  return 0
}

async function handleExportExamples({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: EXPORT_SPEC })
  const sessionDirs = args.lists['--session-dir'] ?? []
  if (sessionDirs.length === 0) throw new ArgParseError('export-examples requires at least one --session-dir')
  const outputDir = requireValue({ args, key: '--output-dir' })
  const { exportExamples } = await import('./curation/inventory')
  const report = await exportExamples({
    sessionDirs,
    outputDir,
    deps: defaultExportDeps({ reparse: reparseScope }),
  })
  console.log(`exported ${report.exported} examples, ${report.rejections.length} rejections -> ${report.outputDir}`)
  return 0
}

async function handleCurate({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: CURATE_SPEC })
  const exportDir = requireValue({ args, key: '--export-dir' })
  const outputDir = requireValue({ args, key: '--output-dir' })
  const { readExportDir, dedupeCandidates, candidateFromExport, writeCandidates } = await import('./curation/candidates')
  const { ECandidateMethod } = await import('./curation/candidates')
  const { examples } = await readExportDir({ exportDir })
  const candidates = examples.map((example) =>
    candidateFromExport({ example, method: ECandidateMethod.ProspectiveCapture }),
  )
  const { kept, duplicates } = dedupeCandidates({ candidates })
  await writeCandidates({ outputDir, candidates: kept })
  console.log(`candidates: ${kept.length} kept, ${duplicates.length} duplicates -> ${outputDir}`)
  return 0
}

async function handleLabelReview({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: LABEL_REVIEW_SPEC })
  const candidatesPath = requireValue({ args, key: '--candidates' })
  const labelsPath = requireValue({ args, key: '--labels' })
  const verificationPath = requireValue({ args, key: '--verification' })
  const outputDir = requireValue({ args, key: '--output-dir' })
  const featureId = args.values['--feature'] ?? 'code-quality/single-responsibility'
  const datasetVersion = requireValue({ args, key: '--dataset-version' })
  const splitValue = args.values['--split'] ?? 'development'
  if (splitValue !== 'development' && splitValue !== 'holdout') {
    throw new ArgParseError(`--split must be "development" or "holdout", got "${splitValue}"`)
  }
  const split = splitValue === 'holdout' ? EDatasetSplit.Holdout : EDatasetSplit.Development
  const { readCandidatesFile, readLabelDrafts, readLabelVerifications, writeGoldenDataset } =
    await import('./curation/label-review-io')
  const { buildGoldenCases } = await import('./curation/label-review')
  const { buildCodeQualityInput } = await import('../code-quality/input-builder')
  const { enabledEvalPolicyIds } = await import('../code-quality/policies')
  const { expectedEvidenceProblem } = await import('../code-quality/expected')
  const { registry } = await import('./registry-default')
  const feature = registry.get({ id: resolveSuiteId({ suite: featureId }) })
  const candidates = await readCandidatesFile({ path: candidatesPath })
  const drafts = await readLabelDrafts({ path: labelsPath })
  const verifications = await readLabelVerifications({ path: verificationPath })
  const { cases, refused } = buildGoldenCases({
    featureId: feature.id,
    candidates,
    drafts,
    verifications,
    buildInput: ({ candidate }) =>
      buildCodeQualityInput({ candidate, policyIds: enabledEvalPolicyIds }),
    validateLabel: expectedEvidenceProblem,
    validateExpected: (expected) => {
      const result = feature.expectedSchema.safeParse(expected)
      return result.success ? null : (result.error.issues[0]?.message ?? 'expected fails schema')
    },
  })
  await writeGoldenDataset({
    outputDir,
    cases,
    refused,
    featureVersions: {
      featureId: feature.id,
      inputSchemaVersion: feature.inputSchemaVersion,
      expectedSchemaVersion: feature.expectedSchemaVersion,
      rubricVersion: feature.rubricVersion,
    },
    split,
    datasetVersion,
  })
  console.log(`golden: ${cases.length} accepted, ${refused.length} refused -> ${outputDir}`)
  return 0
}

export async function handleCurationCommand({
  command,
  argv,
}: {
  command: string
  argv: readonly string[]
}): Promise<number> {
  switch (command) {
    case 'export-examples':
      return handleExportExamples({ argv })
    case 'curate':
      return handleCurate({ argv })
    case 'label-review':
      return handleLabelReview({ argv })
    case 'import-history':
      return handleImportHistory({ argv })
    default:
      throw new ArgParseError(`unknown curation command "${command}"`)
  }
}
