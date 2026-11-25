import { readFile } from 'node:fs/promises'

import { writeFileAtomic, writeJsonAtomic } from './atomic'
import { ArgParseError, parseArgs, requireValue } from './args'
import { resolveEvalPolicies } from '../code-quality/policies'
import {
  JEV_REAL_MODEL,
  createGatewayDecider,
  formatJevRealRow,
  parseJevRealItems,
  runJevRealItem,
} from '../code-quality/jev-real'
import type { JevRealRow } from '../code-quality/jev-real'
import { formatJevRealText, summarizeJevReal } from '../code-quality/jev-real-metrics'

const JEV_REAL_SPEC = {
  '--items': 'value',
  '--out': 'value',
  '--summary': 'value',
  '--policy': 'value',
} as const

const GATEWAY_KEY_ENV = 'AI_GATEWAY_API_KEY'
const DEFAULT_POLICY_ID = 'single-responsibility'

const summaryPathOf = ({ outPath }: { outPath: string }): string =>
  outPath.endsWith('.jsonl')
    ? `${outPath.slice(0, -'.jsonl'.length)}.summary.json`
    : `${outPath}.summary.json`

export async function handleJevRealCommand({ argv }: { argv: readonly string[] }): Promise<number> {
  const args = parseArgs({ argv, spec: JEV_REAL_SPEC })
  const itemsPath = requireValue({ args, key: '--items' })
  const outPath = requireValue({ args, key: '--out' })
  const policyId = args.values['--policy'] ?? DEFAULT_POLICY_ID
  const apiKey = process.env[GATEWAY_KEY_ENV]
  if (apiKey === undefined || apiKey === '')
    throw new ArgParseError(
      `eval:jev-real needs ${GATEWAY_KEY_ENV} to reach ${JEV_REAL_MODEL} through the AI gateway`,
    )

  const policies = resolveEvalPolicies({ policyIds: [policyId] })
  const items = parseJevRealItems({ text: await readFile(itemsPath, 'utf8') })
  const decide = createGatewayDecider({ apiKey })
  const rows: JevRealRow[] = []
  for (const item of items) rows.push(await runJevRealItem({ item, policies, decide }))

  const summary = summarizeJevReal({ rows })
  await writeFileAtomic({
    path: outPath,
    content: `${rows.map((row) => formatJevRealRow({ row })).join('\n')}\n`,
  })
  const summaryPath = args.values['--summary'] ?? summaryPathOf({ outPath })
  await writeJsonAtomic({
    path: summaryPath,
    value: {
      ...summary,
      policyId,
      policyVersions: policies.map((policy) => ({ id: policy.id, version: policy.version })),
      model: JEV_REAL_MODEL,
      itemsPath,
      resultsPath: outPath,
    },
  })
  console.log(formatJevRealText({ summary }))
  console.log(`policy: ${policyId} model: ${JEV_REAL_MODEL}`)
  console.log(`results: ${outPath}`)
  console.log(`summary: ${summaryPath}`)
  return summary.status === 'complete' ? 0 : 1
}
