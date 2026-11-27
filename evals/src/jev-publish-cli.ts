import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { ArgParseError, parseArgs, requireValue } from './args'
import { EQualityImpact } from '@dltech/atlas-core'
import {
  JEV_LABEL_DATASET_ID,
  JEV_LABEL_DEFAULT_POLICY_ID,
  JEV_LABEL_REVIEW_QUEUE_ID,
  JEV_LABEL_SCORE_DEFINITION_ID,
  formatJevLabelSummary,
  summarizeJevLabelRows,
} from '../code-quality/jev-label'
import { parseJevLabelRows, type JevLabelItem } from '../code-quality/jev-label-row'
import { jevRealItemSchema } from '../code-quality/jev-real'
import { publishJevLabels } from '../code-quality/jev-publish'
import type { JevRealOutcome } from '../code-quality/jev-publish-bodies'
import { createPosthogApi, POSTHOG_KEY_ENV } from '../code-quality/posthog-api'

const JEV_PUBLISH_SPEC = {
  '--dir': 'value',
  '--results': 'value',
  '--experiment-name': 'value',
  '--policy': 'value',
  '--definition': 'value',
  '--dataset': 'value',
  '--queue': 'value',
} as const

const outcomeSchema = z.object({
  itemId: z.string().min(1),
  notifyMatch: z.boolean(),
  impactMatch: z.boolean(),
  actual: z
    .object({
      notify: z.boolean(),
      impact: z.enum(EQualityImpact),
      transition: z.string().nullable(),
      status: z.string(),
      currentConcern: z.number().nullable(),
    })
    .nullable(),
})

const jsonLines = ({ text }: { text: string }): readonly string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const parseOutcomes = ({ text }: { text: string }): readonly JevRealOutcome[] =>
  jsonLines({ text }).map((line) => outcomeSchema.parse(JSON.parse(line) as unknown))

const parseItems = ({ text }: { text: string }): readonly JevLabelItem[] =>
  jsonLines({ text }).map((line) => {
    const decoded = JSON.parse(line) as unknown
    jevRealItemSchema.parse(decoded)
    return decoded as JevLabelItem
  })

const readOptional = async ({ path }: { path: string }): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const keyOf = ({
  name,
  env,
}: {
  name: string
  env: Record<string, string | undefined>
}): string => {
  const value = env[name]
  if (value === undefined || value === '') throw new ArgParseError(`eval:jev-publish needs ${name}`)
  return value
}

export async function handleJevPublishCommand({
  argv,
  env = process.env,
}: {
  argv: readonly string[]
  env?: Record<string, string | undefined>
}): Promise<number> {
  const args = parseArgs({ argv, spec: JEV_PUBLISH_SPEC })
  const dir = requireValue({ args, key: '--dir' })
  const rows = parseJevLabelRows({ text: await readFile(join(dir, 'labels.jsonl'), 'utf8') })
  const itemsText = await readOptional({ path: join(dir, 'items.jsonl') })
  const items = itemsText === null ? [] : parseItems({ text: itemsText })
  const resultsPath = args.values['--results']
  const results =
    resultsPath === undefined ? [] : parseOutcomes({ text: await readFile(resultsPath, 'utf8') })
  const startedAt = new Date().toISOString()
  const experimentName =
    args.values['--experiment-name'] ??
    `jev single-responsibility real set, routine run ${startedAt.slice(0, 10)}`

  const outcome = await publishJevLabels({
    api: createPosthogApi({ apiKey: keyOf({ name: POSTHOG_KEY_ENV, env }) }),
    rows: rows.filter((row) => row.error === null),
    items,
    results,
    scoreDefinitionId: args.values['--definition'] ?? JEV_LABEL_SCORE_DEFINITION_ID,
    datasetId: args.values['--dataset'] ?? JEV_LABEL_DATASET_ID,
    reviewQueueId: args.values['--queue'] ?? JEV_LABEL_REVIEW_QUEUE_ID,
    experimentName: resultsPath === undefined ? null : experimentName,
    startedAt,
  })

  console.log(formatJevLabelSummary({ summary: summarizeJevLabelRows({ rows }) }))
  console.log(`policy: ${args.values['--policy'] ?? JEV_LABEL_DEFAULT_POLICY_ID}`)
  console.log(
    `reviews: ${outcome.reviewsCreated} created, ${outcome.reviewsUpdated} updated, ${outcome.queued} queued`,
  )
  console.log(`dataset items: ${outcome.itemsCreated} created, ${outcome.itemsSkipped} skipped`)
  console.log(
    outcome.experimentId === null
      ? 'experiment: none'
      : `experiment: ${outcome.experimentId} with ${outcome.experimentItems} items and ${outcome.experimentResults} results`,
  )
  for (const failure of outcome.failures) console.log(`failure: ${failure}`)
  return outcome.failures.length === 0 ? 0 : 1
}
