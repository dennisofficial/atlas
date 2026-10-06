import { readFile, writeFile } from 'node:fs/promises'

import { z } from 'zod'

import { evalCaseSchema } from './case'
import { registry } from './registry-default'
import { executePlan } from './worker'

const childInputSchema = z.object({
  invocationId: z.string().min(1),
  featureId: z.string().min(1),
  mode: z.enum(['fake', 'live']),
  model: z.object({ requested: z.string().min(1), promotable: z.boolean() }),
  liveConfig: z.object({ baseUrl: z.string(), token: z.string().optional() }).nullable(),
  deadlineMs: z.number().int().positive(),
  rows: z.array(z.object({ caseId: z.string(), trialId: z.string(), variantId: z.string() })).readonly(),
  cases: z.array(evalCaseSchema).readonly(),
  outputPath: z.string().min(1),
  runStartedAt: z.string().min(1),
})

export type ChildInput = z.infer<typeof childInputSchema>

function readManifestPath({ argv }: { argv: readonly string[] }): string {
  const index = argv.indexOf('--manifest')
  const value = argv[index + 1]
  if (index < 0 || value === undefined) throw new Error('child requires --manifest <path>')
  return value
}

function rowsPathOf({ outputPath }: { outputPath: string }): string {
  return outputPath.replace(/evalite\.raw\.json$/, 'rows.normalized.json')
}

async function handleChild(): Promise<void> {
  const manifestPath = readManifestPath({ argv: process.argv })
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  const input = childInputSchema.parse(parsed)

  const feature = registry.get({ id: input.featureId })
  const rows = await executePlan({
    feature,
    cases: input.cases,
    rows: input.rows,
    context: {
      invocationId: input.invocationId,
      model: input.model.requested,
      deadlineMs: input.deadlineMs,
    },
  })

  const exportJson = {
    run: { id: input.invocationId, startedAt: input.runStartedAt, runType: 'full' },
    evals: [
      {
        name: input.featureId,
        results: rows.map((row) => ({
          input: { caseId: row.caseId, trialId: row.trialId, variantId: row.variantId },
          output: row.actual,
          expected: row.expected,
          status: row.status === 'completed' ? 'success' : 'fail',
          scores: Object.entries(row.scores).map(([name, score]) => ({ name, score })),
          error: row.error ?? null,
          timing: row.timing,
        })),
      },
    ],
  }

  await writeFile(input.outputPath, `${JSON.stringify(exportJson, null, 2)}\n`, 'utf8')
  await writeFile(rowsPathOf({ outputPath: input.outputPath }), `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

if (import.meta.main) {
  await handleChild()
}
