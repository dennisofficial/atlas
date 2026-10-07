import { JEV_QUALITY_MODEL } from '@dltech/atlas-core'

import { parseArgs, parseTrials, requireValue, resolveModel, resolveRunMode, ArgParseError } from './args'
import { loadDataset } from './dataset-io'
import { loadFixtureAnswers } from './fixture-answers'
import { loadRunDirectory } from './run-io'
import { ERunMode } from './results'
import { compareRuns, comparisonExitCode, formatComparisonText, formatSummaryText } from './summary'
import { handleRun, type RunRequest } from './supervisor'

const RUN_SPEC = {
  '--suite': 'value',
  '--dataset': 'value',
  '--trials': 'value',
  '--output-parent': 'value',
  '--model': 'value',
  '--baseline': 'value',
  '--answers': 'value',
  '--fake': 'flag',
  '--live': 'flag',
} as const

const COMPARE_SPEC = { '--baseline': 'value', '--candidate': 'value' } as const
const VALIDATE_SPEC = { '--manifest': 'value' } as const

async function handleRunCommand({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: RUN_SPEC })
  const mode = resolveRunMode({ args, env: process.env })
  const model = resolveModel({ args, defaultModel: JEV_QUALITY_MODEL })

  let liveConfig: RunRequest['liveConfig']
  if (mode === ERunMode.Live) {
    const baseUrl = process.env.ATLAS_EVAL_DECISIONS_URL
    if (baseUrl === undefined || baseUrl === '') {
      throw new ArgParseError('live mode requires ATLAS_EVAL_DECISIONS_URL; missing configuration is a config error')
    }
    liveConfig = { baseUrl, token: process.env.ATLAS_EVAL_DECISIONS_TOKEN }
  }

  const outputParent = args.values['--output-parent'] ?? process.env.ATLAS_EVAL_OUTPUT
  if (outputParent === undefined) throw new ArgParseError('run requires --output-parent (or ATLAS_EVAL_OUTPUT)')

  let fakeAnswers: RunRequest['fakeAnswers']
  if (mode === ERunMode.Fake && args.values['--answers'] !== undefined) {
    fakeAnswers = await loadFixtureAnswers({ path: args.values['--answers'] as string })
  }

  const result = await handleRun({
    request: {
      suite: requireValue({ args, key: '--suite' }),
      datasetPath: args.values['--dataset'],
      trials: parseTrials({ args }),
      outputParent,
      mode,
      model,
      liveConfig,
      fakeAnswers,
      baselineDir: args.values['--baseline'],
    },
  })
  console.log(formatSummaryText({ summary: result.summary }))
  console.log(`artifacts: ${result.runDirectory}`)
  return result.exitCode
}

async function handleValidateCommand({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: VALIDATE_SPEC })
  const { registry } = await import('./registry-default')
  const manifestPath = requireValue({ args, key: '--manifest' })
  const feature = registry.get({ id: (await readManifestFeatureId({ manifestPath })) })
  const loaded = await loadDataset({ feature, datasetPath: manifestPath, suite: feature.id })
  console.log(`valid: ${loaded.cases.length} accepted cases, dataset ${loaded.manifest.datasetVersion}`)
  return 0
}

async function readManifestFeatureId({ manifestPath }: { manifestPath: string }): Promise<string> {
  const parsed: unknown = JSON.parse(await Bun.file(manifestPath).text())
  if (typeof parsed !== 'object' || parsed === null) throw new ArgParseError('manifest is not an object')
  const featureId = (parsed as { featureId?: unknown }).featureId
  if (typeof featureId !== 'string' || featureId === '') throw new ArgParseError('manifest lacks featureId')
  return featureId
}

async function handleCompareCommand({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: COMPARE_SPEC })
  const baseline = await loadRunDirectory({ directory: requireValue({ args, key: '--baseline' }) })
  const candidate = await loadRunDirectory({ directory: requireValue({ args, key: '--candidate' }) })
  const comparison = compareRuns({ baseline, candidate })
  console.log(formatComparisonText({ comparison, baseline, candidate }))
  return comparisonExitCode({ comparison, candidate })
}

async function handleDispatch(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'run':
      return handleRunCommand({ argv: rest })
    case 'validate':
      return handleValidateCommand({ argv: rest })
    case 'compare':
      return handleCompareCommand({ argv: rest })
    case 'export-examples':
    case 'curate':
    case 'label-review': {
      const { handleCurationCommand } = await import('./curation-cli')
      return handleCurationCommand({ command, argv: rest })
    }
    default:
      throw new ArgParseError(`unknown command "${command ?? ''}"; expected run|validate|compare|export-examples|curate|label-review`)
  }
}

if (import.meta.main) {
  try {
    const code = await handleDispatch()
    process.exit(code)
  } catch (fault) {
    console.error(fault instanceof Error ? fault.message : String(fault))
    process.exit(2)
  }
}
