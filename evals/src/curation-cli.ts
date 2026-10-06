import { ArgParseError, parseArgs, requireValue } from './args'
import { redactText } from './curation/redact'

const EXPORT_SPEC = { '--session-dir': 'value', '--output-dir': 'value' } as const
const CURATE_SPEC = { '--export-dir': 'value', '--output-dir': 'value' } as const
const LABEL_REVIEW_SPEC = {
  '--candidates': 'value',
  '--labels': 'value',
  '--verification': 'value',
  '--output-dir': 'value',
} as const

function reparseAdapter(): boolean {
  return true
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
    deps: { redact: (text: string) => redactText({ text }), reparse: () => reparseAdapter() },
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
  const { readCandidatesFile, readLabelDrafts, readLabelVerifications, writeGoldenDataset } =
    await import('./curation/label-review-io')
  const { buildGoldenCases } = await import('./curation/label-review')
  const { candidates, featureId } = await readCandidatesFile({ path: candidatesPath })
  const drafts = await readLabelDrafts({ path: labelsPath })
  const verifications = await readLabelVerifications({ path: verificationPath })
  const { cases, refused } = buildGoldenCases({ featureId, candidates, drafts, verifications })
  await writeGoldenDataset({ outputDir, cases, refused })
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
    default:
      throw new ArgParseError(`unknown curation command "${command}"`)
  }
}
