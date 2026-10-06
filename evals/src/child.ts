import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { runEvalite } from 'evalite/runner'
import { InMemoryStorage } from 'evalite/in-memory-storage'
import { z } from 'zod'

import { evalCaseSchema } from './case'

const distDirectory = dirname(fileURLToPath(import.meta.url))

const childInputSchema = z.object({
  invocationId: z.string().min(1),
  featureId: z.string().min(1),
  mode: z.enum(['fake', 'live']),
  model: z.object({ requested: z.string().min(1), promotable: z.boolean() }),
  liveConfig: z.object({ baseUrl: z.string(), token: z.string().optional() }).nullable(),
  deadlineMs: z.number().int().positive(),
  rows: z.array(z.object({ caseId: z.string(), trialId: z.string(), variantId: z.string() })).readonly(),
  cases: z.array(evalCaseSchema).readonly(),
  answers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
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

function devNullWritable(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
}

const LOADER_FILE = 'loader.eval.ts'

function loaderSource({ globalsPath, adapterPath }: { globalsPath: string; adapterPath: string }): string {
  return [
    'import { readFile } from "node:fs/promises"',
    `const parsed = JSON.parse(await readFile(${JSON.stringify(globalsPath)}, "utf8"))`,
    `const { registerCodeQualityEval } = await import(${JSON.stringify(adapterPath)})`,
    'registerCodeQualityEval({ deps: parsed.deps, rows: parsed.rows })',
    '',
  ].join('\n')
}

async function handleChild(): Promise<void> {
  const manifestPath = readManifestPath({ argv: process.argv })
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  const input = childInputSchema.parse(parsed)
  const workDirectory = process.cwd()

  const rows = input.rows.map((row) => {
    const evalCase = input.cases.find((candidate) => candidate.id === row.caseId)
    if (evalCase === undefined) throw new Error(`planned row ${row.caseId} has no case`)
    return { ...row, evalCase }
  })

  const globalsPath = join(workDirectory, 'globals.json')
  const globals = {
    deps: {
      mode: input.mode,
      model: input.model.requested,
      deadlineMs: input.deadlineMs,
      ...(input.mode === 'fake' ? { answers: input.answers ?? {} } : {}),
      ...(input.liveConfig === null ? {} : { liveConfig: input.liveConfig }),
    },
    rows,
  }
  await writeFile(globalsPath, JSON.stringify(globals), 'utf8')

  const adapterPath = resolve(join(distDirectory, 'entry.eval.mjs'))
  await mkdir(workDirectory, { recursive: true })
  await writeFile(join(workDirectory, LOADER_FILE), loaderSource({ globalsPath, adapterPath }), 'utf8')

  await runEvalite({
    path: LOADER_FILE,
    cwd: workDirectory,
    mode: 'run-once-and-exit',
    disableServer: true,
    hideTable: true,
    storage: InMemoryStorage.create(),
    outputPath: input.outputPath,
    testOutputWritable: devNullWritable(),
  })
}

if (import.meta.main) {
  await handleChild()
}
