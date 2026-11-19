import { describe, expect, it } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import triggerConfig from '../../trigger.config'

const API_ROOT = resolve(import.meta.dir, '../..')
const TASK_CALL = /\.task\(|schedules\.task\(|schemaTask\(|tasks\.task\(/
// @nestjs/common and @nestjs/config are already reachable from some task graphs and bundle fine; the
// release job dies on Nest's core, platform and transport packages, which resolve optional peers.
const NEST_RUNTIME =
  /[\\/]@nestjs[\\/](core|microservices|websockets|testing|schedule|throttler|platform-[a-z-]+)[\\/]/
const AGENT_BARREL = /[\\/]src[\\/]agent[\\/]index\.ts$/
const CONDITIONS = triggerConfig.build?.conditions ?? []
const TASK_DIRS = triggerConfig.dirs ?? ['./src/trigger']

type BundleFailure = {
  entry: string
  success: boolean
  offenders: string[]
  errors: string[]
}

const taskEntrypoints = (): string[] => {
  const entries = new Set<string>()
  for (const dir of TASK_DIRS) {
    const absolute = resolve(API_ROOT, dir)
    for (const file of new Glob('**/*.ts').scanSync({ cwd: absolute })) {
      if (/\.(spec|test)\.ts$/.test(file)) continue
      if (TASK_CALL.test(readFileSync(resolve(absolute, file), 'utf8'))) {
        entries.add(resolve(absolute, file))
      }
    }
  }
  return [...entries].sort()
}

const bundleOf = async (entry: string): Promise<BundleFailure> => {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    conditions: CONDITIONS,
    metafile: true,
    throw: false,
  })
  const inputs = Object.keys(result.metafile?.inputs ?? {})
  return {
    entry: relative(API_ROOT, entry),
    success: result.success,
    offenders: inputs
      .filter((input) => NEST_RUNTIME.test(input) || AGENT_BARREL.test(input))
      .map((input) => relative(API_ROOT, resolve(input))),
    errors: result.logs.filter((log) => log.level === 'error').map((log) => String(log.message)),
  }
}

const clean = (entry: string): BundleFailure => ({
  entry,
  success: true,
  offenders: [],
  errors: [],
})

describe('trigger task bundles', () => {
  const entries = taskEntrypoints()

  it('finds the task entrypoints trigger would deploy', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  for (const entry of entries) {
    it(`keeps Nest and the agent barrel out of ${relative(API_ROOT, entry)}`, async () => {
      const failure = await bundleOf(entry)
      expect(failure).toEqual(clean(failure.entry))
    })
  }
})
