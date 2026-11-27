import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'

export type TestPackage = { dir: string; name: string; script: string; specs: number }
export type ShardCommand = { name: string; dir: string; command: string }

const PARALLEL = /\s--parallel(?=\s|$)/
const PARALLEL_FLAG = /\s--parallel(=\d+)?(?=\s|$)/
export const API_WORKERS = 2

const SHARDABLE = /^bun test(\s[^&|;]*)?$/
const WORKSPACE_GLOBS = ['packages/*/package.json', 'plugins/*/package.json', 'apps/*/package.json']
const SINGLE_WORKSPACES = ['commands/package.json', 'evals/package.json']
const EXCLUDED = new Set(['@dltech/bun-test-incremental'])

export function shardCommands(args: {
  packages: readonly TestPackage[]
  shard: number
  total: number
}): ShardCommand[] {
  const { packages, shard, total } = args
  const largestFirst = [...packages].sort((left, right) => right.specs - left.specs)
  return largestFirst.flatMap((pkg) => {
    if (SHARDABLE.test(pkg.script)) {
      const script = pkg.script.replace(PARALLEL, (match) =>
        match.replace('--parallel', `--parallel=${API_WORKERS}`),
      )
      return [{ name: pkg.name, dir: pkg.dir, command: `${script} --shard=${shard}/${total}` }]
    }
    return shard === 1 ? [{ name: pkg.name, dir: pkg.dir, command: pkg.script }] : []
  })
}

function specCount(dir: string): number {
  const specs = new Bun.Glob('**/*.{spec,test}.{ts,tsx}').scanSync({ cwd: dir })
  return [...specs].filter((path) => !path.includes('node_modules/')).length
}

export async function runPooled<T>(args: {
  items: readonly T[]
  limit: number
  weightOf: (item: T) => number
  run: (item: T) => Promise<number>
}): Promise<number[]> {
  const { items, limit, weightOf, run } = args
  const codes: number[] = new Array(items.length)
  const waiting = items.map((item, index) => ({
    item,
    index,
    weight: Math.min(limit, weightOf(item)),
  }))
  let free = limit
  await new Promise<void>((resolve) => {
    let running = 0
    const pump = () => {
      while (waiting.length > 0 && (waiting[0]?.weight ?? 0) <= free) {
        const next = waiting.shift()
        if (next === undefined) break
        free -= next.weight
        running++
        run(next.item).then((code) => {
          codes[next.index] = code
          free += next.weight
          running--
          pump()
        })
      }
      if (waiting.length === 0 && running === 0) resolve()
    }
    pump()
  })
  return codes
}

export const coresHeldBy = (command: ShardCommand, cores: number) =>
  PARALLEL_FLAG.test(command.command) ? cores : 1

function testPackages(root: string): TestPackage[] {
  const manifests = [
    ...WORKSPACE_GLOBS.flatMap((glob) => [...new Bun.Glob(glob).scanSync({ cwd: root })]),
    ...SINGLE_WORKSPACES,
  ]
  return manifests.sort().flatMap((manifest) => {
    const json: unknown = JSON.parse(readFileSync(join(root, manifest), 'utf8'))
    if (typeof json !== 'object' || json === null) return []
    const name: unknown = Reflect.get(json, 'name')
    const scripts: unknown = Reflect.get(json, 'scripts')
    const script =
      typeof scripts === 'object' && scripts !== null ? Reflect.get(scripts, 'test') : undefined
    if (typeof name !== 'string' || typeof script !== 'string' || EXCLUDED.has(name)) return []
    const dir = join(root, manifest.slice(0, -'/package.json'.length))
    return [{ dir, name, script, specs: specCount(dir) }]
  })
}

async function pipeLines(args: { stream: ReadableStream<Uint8Array>; prefix: string }) {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of args.stream) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) console.log(`${args.prefix}${line}`)
  }
  if (pending) console.log(`${args.prefix}${pending}`)
}

async function runCommand(command: ShardCommand): Promise<number> {
  const child = Bun.spawn({
    cmd: ['sh', '-c', command.command],
    cwd: command.dir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const prefix = `${command.name} | `
  await Promise.all([
    pipeLines({ stream: child.stdout, prefix }),
    pipeLines({ stream: child.stderr, prefix }),
  ])
  const code = await child.exited
  console.log(`${prefix}exited with code ${code}`)
  return code
}

if (import.meta.main) {
  const [shard, total] = (process.argv[2] ?? '1/1').split('/').map(Number)
  if (!shard || !total || shard > total) throw new Error(`usage: ci-test-shard.ts <n>/<total>`)
  const commands = shardCommands({ packages: testPackages(process.cwd()), shard, total })
  const cores = availableParallelism()
  const codes = await runPooled({
    items: commands,
    limit: cores,
    weightOf: (command) => coresHeldBy(command, cores),
    run: runCommand,
  })
  const failed = commands.filter((_, index) => codes[index] !== 0).map((command) => command.name)
  if (failed.length > 0) {
    console.error(`failed: ${failed.join(', ')}`)
    process.exit(1)
  }
}
