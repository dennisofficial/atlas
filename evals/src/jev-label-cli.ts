import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseArgs, requireValue, ArgParseError } from './args'
import { writeFileAtomic } from './atomic'
import { JEV_LABEL_MODELS } from '../code-quality/jev-label-answer'
import { createGatewayLabeller, JEV_LABEL_GATEWAY_KEY_ENV } from '../code-quality/jev-label-gateway'
import {
  JEV_LABEL_DEFAULT_POLICY_ID,
  JEV_LABEL_SCORE_DEFINITION_ID,
  formatJevLabelSummary,
  runJevLabel,
  summarizeJevLabelRows,
} from '../code-quality/jev-label'
import { formatJevLabelRow } from '../code-quality/jev-label-row'
import { createPosthogApi, POSTHOG_KEY_ENV } from '../code-quality/posthog-api'

const JEV_LABEL_SPEC = {
  '--since': 'value',
  '--out-dir': 'value',
  '--near-miss': 'value',
  '--random': 'value',
  '--seed': 'value',
  '--models': 'value',
  '--policy': 'value',
  '--definition': 'value',
  '--rubric': 'value',
} as const

const DEFAULT_RUBRIC_URL = new URL('../code-quality/srp-label-rubric.md', import.meta.url)

const countOf = ({ raw, key }: { raw: string | undefined; key: string }): number | undefined => {
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new ArgParseError(`${key} must be a non-negative integer, got "${raw}"`)
  return parsed
}

const keyOf = ({
  name,
  env,
}: {
  name: string
  env: Record<string, string | undefined>
}): string => {
  const value = env[name]
  if (value === undefined || value === '') throw new ArgParseError(`eval:jev-label needs ${name}`)
  return value
}

export async function handleJevLabelCommand({
  argv,
  env = process.env,
}: {
  argv: readonly string[]
  env?: Record<string, string | undefined>
}): Promise<number> {
  const args = parseArgs({ argv, spec: JEV_LABEL_SPEC })
  const since = requireValue({ args, key: '--since' })
  const outDir = requireValue({ args, key: '--out-dir' })
  const rubricPath = args.values['--rubric'] ?? DEFAULT_RUBRIC_URL
  const rubric = await readFile(rubricPath, 'utf8')
  const models = (args.values['--models'] ?? JEV_LABEL_MODELS.join(',')).split(',')
  const nearMiss = countOf({ raw: args.values['--near-miss'], key: '--near-miss' })
  const random = countOf({ raw: args.values['--random'], key: '--random' })
  const seed = args.values['--seed']
  const api = createPosthogApi({ apiKey: keyOf({ name: POSTHOG_KEY_ENV, env }) })
  const labeller = createGatewayLabeller({
    apiKey: keyOf({ name: JEV_LABEL_GATEWAY_KEY_ENV, env }),
  })

  const run = await runJevLabel({
    api,
    labeller,
    since,
    rubric,
    models,
    policyId: args.values['--policy'] ?? JEV_LABEL_DEFAULT_POLICY_ID,
    scoreDefinitionId: args.values['--definition'] ?? JEV_LABEL_SCORE_DEFINITION_ID,
    ...(nearMiss === undefined ? {} : { nearMiss }),
    ...(random === undefined ? {} : { random }),
    ...(seed === undefined ? {} : { seed }),
  })

  const labelsPath = join(outDir, 'labels.jsonl')
  const itemsPath = join(outDir, 'items.jsonl')
  await writeFileAtomic({
    path: labelsPath,
    content: `${run.rows.map((row) => formatJevLabelRow({ row })).join('\n')}\n`,
  })
  await writeFileAtomic({
    path: itemsPath,
    content: `${run.items.map((item) => JSON.stringify(item)).join('\n')}\n`,
  })

  const summary = summarizeJevLabelRows({ rows: run.rows })
  console.log(formatJevLabelSummary({ summary }))
  console.log(`models: ${models.join(', ')}`)
  console.log(`labels: ${labelsPath}`)
  console.log(`items: ${itemsPath}`)
  return summary.errors === 0 ? 0 : 1
}
