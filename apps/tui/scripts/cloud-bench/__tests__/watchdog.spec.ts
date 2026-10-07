import { afterEach, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sandboxNameFor } from '@dltech/atlas-harness'
import { runBenchmarkWorker } from '../watchdog'

// Measured: bun took ~6s to start scripts under this machine's macOS $TMPDIR but ~0.1s under /tmp.
const SCRATCH_PARENT = '/tmp'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const workspace = async (entrySource: string) => {
  const root = await mkdtemp(join(SCRATCH_PARENT, 'cloud-bench-watchdog-'))
  roots.push(root)
  const directory = join(root, 'sample')
  await mkdir(directory)
  const entry = join(root, 'entry.ts')
  await writeFile(entry, entrySource)
  const input = join(directory, 'sample.json')
  await writeFile(input, '{}')
  return { root, directory, entry, input }
}

const run = (
  box: Awaited<ReturnType<typeof workspace>>,
  extra: { timeoutMs?: number; killGraceMs?: number; cwd?: string } = {},
) =>
  runBenchmarkWorker({
    entry: box.entry,
    input: box.input,
    cwd: extra.cwd ?? box.root,
    directory: box.directory,
    env: { PATH: process.env.PATH },
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
    ...(extra.killGraceMs === undefined ? {} : { killGraceMs: extra.killGraceMs }),
  })

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitForFile = async (path: string): Promise<string> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const text = await readFile(path, 'utf8')
      if (text.endsWith('\n')) return text.trim()
    } catch {
      await sleep(25)
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

const waitUntilDead = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!alive(pid)) return true
    await sleep(25)
  }
  return false
}

const stubbornTree = (pidFile: string) => `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
process.on('SIGTERM', () => {})
const grandchild = spawn(
  process.execPath,
  ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  { stdio: 'ignore' },
)
writeFileSync(${JSON.stringify(pidFile)}, process.pid + ' ' + grandchild.pid + '\\n')
setInterval(() => {}, 1000)
`

const listenerCounts = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]

describe('runBenchmarkWorker', () => {
  it('passes the worker flag, captures output privately and resolves on a clean exit', async () => {
    const box = await workspace(
      `console.log('args ' + process.argv.slice(2).join(' ')); console.error('diag')`,
    )
    await run(box)
    expect(await readFile(join(box.directory, 'process.stdout'), 'utf8')).toBe(
      `args --worker=${box.input}\n`,
    )
    expect(await readFile(join(box.directory, 'process.stderr'), 'utf8')).toBe('diag\n')
    for (const name of ['process.stdout', 'process.stderr'])
      expect((await stat(join(box.directory, name))).mode & 0o777).toBe(0o600)
  })

  it('rejects a nonzero exit naming the artifact directory and recorded sandbox', async () => {
    const box = await workspace('process.exit(3)')
    await writeFile(
      join(box.directory, 'timeline.jsonl'),
      [
        JSON.stringify({ phase: 'fixture', threadId: 'brn_cloned', transcript: 'SECRET' }),
        JSON.stringify({ phase: 'failure', sandboxName: 'atlas-thread-recorded' }),
        '',
      ].join('\n'),
    )
    const failure = await run(box).then(
      () => undefined,
      (error: Error) => error,
    )
    expect(failure?.message).toContain('status 3')
    expect(failure?.message).toContain(box.directory)
    expect(failure?.message).toContain('atlas-thread-recorded')
    expect(failure?.message).not.toContain('SECRET')
  })

  it('derives the sandbox from the cloned thread when no failure was recorded', async () => {
    const box = await workspace('process.exit(1)')
    await writeFile(
      join(box.directory, 'timeline.jsonl'),
      `${JSON.stringify({ phase: 'fixture', threadId: 'brn_cloned' })}\n{"phase":"span-st`,
    )
    const failure = await run(box).then(
      () => undefined,
      (error: Error) => error,
    )
    expect(failure?.message).toContain(sandboxNameFor({ threadId: 'brn_cloned' }))
  })

  it('says no sandbox was recorded when the worker died before the fixture phase', async () => {
    const box = await workspace('process.exit(1)')
    const failure = await run(box).then(
      () => undefined,
      (error: Error) => error,
    )
    expect(failure?.message).toContain('no benchmark sandbox was recorded')
  })

  it('kills the whole process group on the whole-sample deadline, even with a result file', async () => {
    const box = await workspace('')
    const pidFile = join(box.root, 'pids')
    await writeFile(box.entry, stubbornTree(pidFile))
    await writeFile(join(box.directory, 'result.json'), '{"ok":true}')
    const before = listenerCounts()
    const failure = await run(box, { timeoutMs: 1_500, killGraceMs: 200 }).then(
      () => undefined,
      (error: Error) => error,
    )
    const [leader, grandchild] = (await waitForFile(pidFile)).split(' ').map(Number)
    expect(failure?.message).toContain('1500ms whole-sample deadline')
    expect(failure?.message).toContain(box.directory)
    expect(await waitUntilDead(leader ?? 0)).toBe(true)
    expect(await waitUntilDead(grandchild ?? 0)).toBe(true)
    expect(listenerCounts()).toEqual(before)
  })

  it('reports a spawn failure and releases every handler', async () => {
    const box = await workspace('')
    const before = listenerCounts()
    const failure = await run(box, { cwd: join(box.root, 'missing') }).then(
      () => undefined,
      (error: Error) => error,
    )
    expect(failure?.message).toContain('could not start')
    expect(failure?.message).toContain(box.directory)
    expect(listenerCounts()).toEqual(before)
  })

  it('refuses to reuse output files', async () => {
    const box = await workspace('')
    await writeFile(join(box.directory, 'process.stdout'), 'old')
    await expect(run(box)).rejects.toThrow('EEXIST')
  })

  it('forwards a parent SIGINT to its own child group only, then rejects with the recovery path', async () => {
    const box = await workspace('')
    const pidFile = join(box.root, 'pids')
    await writeFile(box.entry, stubbornTree(pidFile))
    const harness = join(box.root, 'harness.ts')
    await writeFile(
      harness,
      `
import { runBenchmarkWorker } from ${JSON.stringify(join(import.meta.dir, '../watchdog'))}
try {
  await runBenchmarkWorker({
    entry: ${JSON.stringify(box.entry)},
    input: ${JSON.stringify(box.input)},
    cwd: ${JSON.stringify(box.root)},
    directory: ${JSON.stringify(box.directory)},
    env: { PATH: process.env.PATH },
    timeoutMs: 60000,
    killGraceMs: 200,
  })
  console.log('UNEXPECTED SUCCESS')
} catch (error) {
  console.log('REJECTED ' + (error instanceof Error ? error.message : String(error)))
}
console.log('LISTENERS ' + process.listenerCount('SIGINT') + ' ' + process.listenerCount('SIGTERM'))
process.exit(0)
`,
    )
    const host = spawn(process.execPath, [harness], { stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    host.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const closed = new Promise<void>((resolve) => host.on('close', () => resolve()))
    const [leader, grandchild] = (await waitForFile(pidFile)).split(' ').map(Number)
    host.kill('SIGINT')
    await closed
    expect(output).toContain('REJECTED')
    expect(output).toContain('SIGINT')
    expect(output).toContain(box.directory)
    expect(output).toContain('LISTENERS 0 0')
    expect(await waitUntilDead(leader ?? 0)).toBe(true)
    expect(await waitUntilDead(grandchild ?? 0)).toBe(true)
  })

  it('keeps the live-cloud gate on the benchmark entry', async () => {
    const entry = join(import.meta.dir, '../../bench-cloud.ts')
    const gated = spawn(process.execPath, [entry, '--session=brn_x'], {
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    gated.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const code = await new Promise<number | null>((resolve) => gated.on('close', resolve))
    expect(code).not.toBe(0)
    expect(stderr).toContain('ATLAS_LIVE_CLOUD_BENCH=1')
  })
})
