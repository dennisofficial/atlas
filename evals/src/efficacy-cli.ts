import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { z } from 'zod'

import { writeFileAtomic } from './atomic'
import { ArgParseError, parseArgs, requireValue } from './args'
import { loadDataset } from './dataset-io'
import { ERunMode, ERunStatus } from './results'
import { loadRunDirectory } from './run-io'
import { sha256Hex } from './hash'
import { RUN_MANIFEST_SCHEMA_VERSION } from './run-plan'
import { EDiagnosticStatus } from '../code-quality/efficacy-gates'
import { EfficacyInputError, parseJudgmentsJsonl } from '../code-quality/efficacy-judgment'
import { analyzeSrpEfficacy } from '../code-quality/efficacy-report'
import { formatEfficacyText } from '../code-quality/efficacy-text'
import { CODE_QUALITY_FEATURE_ID, createCodeQualityFeature } from '../code-quality/feature'

const EFFICACY_SPEC = { '--run': 'value', '--dataset': 'value', '--judgments': 'value', '--output-dir': 'value' } as const

const plannedRowSchema = z.object({ caseId: z.string().min(1), trialId: z.string().min(1), variantId: z.string().min(1) })

const invocationSchema = z.object({
  schemaVersion: z.literal(RUN_MANIFEST_SCHEMA_VERSION),
  invocationId: z.string().min(1),
  featureId: z.string().min(1),
  mode: z.enum(ERunMode),
  dataset: z.object({ version: z.string().min(1), hash: z.string().min(1) }),
  model: z.object({ requested: z.string().min(1) }),
  planned: z.object({
    uniqueCases: z.number().int().nonnegative(),
    trialsPerCase: z.number().int().positive(),
    variants: z.array(z.string().min(1)),
    rows: z.array(plannedRowSchema),
  }),
})

type Invocation = z.infer<typeof invocationSchema>

const unusedRunner = async (): Promise<never> => {
  throw new Error('the efficacy report never executes the feature')
}

async function exists({ path }: { path: string }): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readInvocation({ runDirectory }: { runDirectory: string }): Promise<Invocation> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(runDirectory, 'invocation.manifest.json'), 'utf8'))
  } catch {
    throw new EfficacyInputError({ problems: [`no readable invocation.manifest.json in ${runDirectory}`] })
  }
  const decoded = invocationSchema.safeParse(parsed)
  if (!decoded.success) throw new EfficacyInputError({ problems: [`invocation manifest invalid: ${decoded.error.issues[0]?.message ?? 'invalid'}`] })
  return decoded.data
}

function planProblems({ invocation, caseIds }: { invocation: Invocation; caseIds: readonly string[] }): readonly string[] {
  const { planned } = invocation
  const problems: string[] = []
  const expectedRows = caseIds.length * planned.trialsPerCase * planned.variants.length
  if (planned.rows.length !== expectedRows) problems.push(`planned rows ${planned.rows.length} != cases x trials x variants ${expectedRows}`)
  if (planned.uniqueCases !== caseIds.length) problems.push(`planned uniqueCases ${planned.uniqueCases} != dataset cases ${caseIds.length}`)
  const known = new Set(caseIds)
  const keys = new Set<string>()
  for (const row of planned.rows) {
    if (!known.has(row.caseId)) problems.push(`planned row for case "${row.caseId}" outside the dataset`)
    const key = JSON.stringify([row.caseId, row.trialId, row.variantId])
    if (keys.has(key)) problems.push(`duplicate planned row ${row.caseId}/${row.trialId}/${row.variantId}`)
    keys.add(key)
  }
  for (const caseId of caseIds) {
    const count = planned.rows.filter((row) => row.caseId === caseId).length
    if (count !== planned.trialsPerCase * planned.variants.length) problems.push(`case "${caseId}" has ${count} planned rows`)
  }
  return problems
}

async function prepareOutputDirectory({ outputDir, runDirectory }: { outputDir: string; runDirectory: string }): Promise<void> {
  const fromRun = relative(resolve(runDirectory), resolve(outputDir))
  if (fromRun === '' || (!fromRun.startsWith('..') && !isAbsolute(fromRun))) {
    throw new ArgParseError('--output-dir is inside the run directory; reports never write into a run')
  }
  if (await exists({ path: outputDir })) throw new ArgParseError(`--output-dir ${outputDir} already exists; reports need a fresh directory`)
}

export async function handleEfficacyCommand({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: EFFICACY_SPEC })
  const runDirectory = requireValue({ args, key: '--run' })
  const datasetPath = requireValue({ args, key: '--dataset' })
  const judgmentsPath = requireValue({ args, key: '--judgments' })
  const outputDir = requireValue({ args, key: '--output-dir' })
  await prepareOutputDirectory({ outputDir, runDirectory })

  const invocation = await readInvocation({ runDirectory })
  const feature = createCodeQualityFeature({ runner: unusedRunner })
  const loaded = await loadDataset({ feature, datasetPath, suite: CODE_QUALITY_FEATURE_ID })
  const problems: string[] = []
  if (invocation.featureId !== CODE_QUALITY_FEATURE_ID) problems.push(`run feature ${invocation.featureId} is not ${CODE_QUALITY_FEATURE_ID}`)
  if (invocation.dataset.hash !== loaded.manifest.contentHash) problems.push('run dataset hash does not match the supplied dataset')
  if (invocation.dataset.version !== loaded.manifest.datasetVersion) problems.push('run dataset version does not match the supplied dataset')
  problems.push(...planProblems({ invocation, caseIds: loaded.cases.map((evalCase) => evalCase.id) }))
  if (problems.length > 0) throw new EfficacyInputError({ problems })

  const run = await loadRunDirectory({ directory: runDirectory })
  if (run.summary.invocationId !== invocation.invocationId) throw new EfficacyInputError({ problems: ['summary invocation id differs from the invocation manifest'] })
  if (run.summary.mode !== invocation.mode) throw new EfficacyInputError({ problems: ['summary mode differs from the invocation manifest'] })
  if (run.summary.status !== ERunStatus.Complete && run.summary.status !== ERunStatus.QualityRegression) {
    throw new EfficacyInputError({ problems: [`run summary status is ${run.summary.status}; only a complete or complete-quality-regression run can be reported`] })
  }
  if (run.summary.featureId !== invocation.featureId) throw new EfficacyInputError({ problems: ['summary feature id differs from the invocation manifest'] })
  if (run.summary.datasetHash !== invocation.dataset.hash) throw new EfficacyInputError({ problems: ['summary dataset hash differs from the invocation manifest'] })
  if (run.summary.model.requested !== invocation.model.requested) throw new EfficacyInputError({ problems: ['summary requested model differs from the invocation manifest'] })
  const judgmentsText = await readFile(judgmentsPath, 'utf8')
  const judgments = parseJudgmentsJsonl({ text: judgmentsText })
  const report = analyzeSrpEfficacy({
    cases: loaded.cases,
    rows: run.rows,
    judgments,
    plan: invocation.planned.rows,
    requestedModel: invocation.model.requested,
  })
  const runIdentity = {
    invocationId: invocation.invocationId,
    mode: invocation.mode,
    requestedModel: invocation.model.requested,
    datasetVersion: loaded.manifest.datasetVersion,
    datasetHash: loaded.manifest.contentHash,
    trialsPerCase: invocation.planned.trialsPerCase,
    judgmentsSha256: sha256Hex({ text: judgmentsText }),
  }
  const liveEfficacy = invocation.mode === ERunMode.Live
  const modeNotice = invocation.mode === ERunMode.Fake ? 'fake execution; not live efficacy' : 'live execution'
  const text = `mode: ${invocation.mode} (${modeNotice}) | model: ${invocation.model.requested} | liveEfficacy: ${liveEfficacy}\n${formatEfficacyText({ report })}`
  await mkdir(dirname(resolve(outputDir)), { recursive: true })
  await mkdir(outputDir)
  await writeFileAtomic({ path: join(outputDir, 'report.json'), content: `${JSON.stringify({ ...report, liveEfficacy, run: runIdentity }, null, 2)}\n` })
  await writeFileAtomic({ path: join(outputDir, 'report.txt'), content: text })
  console.log(text)
  console.log(`artifacts: ${outputDir}`)
  return report.diagnosticStatus === EDiagnosticStatus.Blocked ? 1 : 0
}
