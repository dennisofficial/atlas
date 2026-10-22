import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SERVE_MAIN_PATH = 'apps/serve/src/main.ts'

const MARK_BYTES = 8
const RESTORING_SIGNALS = ['SIGINT', 'SIGTERM'] as const

export type SourceMark = { repoRoot: string; mark: string; restore: () => Promise<void> }

const git = async (args: { cwd: string; argv: readonly string[] }): Promise<string> => {
  const proc = Bun.spawn({
    cmd: ['git', ...args.argv],
    cwd: args.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0)
    throw new Error(`git ${args.argv.join(' ')} exited ${exitCode}: ${stderr.trim()}`)
  return stdout
}

export const markLineOf = (mark: string): string => `\nprocess.env.ATLAS_RIG_MARK ??= '${mark}'\n`

export const freshMark = (): string => randomBytes(MARK_BYTES).toString('hex')

export async function markSourceAt(args: {
  repoRoot: string
  mark?: string | undefined
}): Promise<SourceMark> {
  const dirty = (
    await git({ cwd: args.repoRoot, argv: ['status', '--porcelain', SERVE_MAIN_PATH] })
  ).trim()
  if (dirty.length > 0) {
    throw new Error(
      `refusing to mark ${SERVE_MAIN_PATH}: it already has uncommitted changes (${dirty})`,
    )
  }
  const file = join(args.repoRoot, SERVE_MAIN_PATH)
  const original = await readFile(file)
  const mark = args.mark ?? freshMark()

  let restoring: Promise<void> | undefined
  const handlers = new Map<NodeJS.Signals, () => void>()

  const removeHandlers = (): void => {
    for (const [signal, handler] of handlers) process.off(signal, handler)
    handlers.clear()
  }

  const restore = (): Promise<void> => {
    restoring ??= (async () => {
      removeHandlers()
      await writeFile(file, original)
    })()
    return restoring
  }

  for (const signal of RESTORING_SIGNALS) {
    const handleSignal = (): void => {
      void restore().finally(() => {
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
      })
    }
    handlers.set(signal, handleSignal)
    process.on(signal, handleSignal)
  }

  try {
    await writeFile(file, Buffer.concat([original, Buffer.from(markLineOf(mark))]))
  } catch (failure) {
    await restore()
    throw failure
  }
  return { repoRoot: args.repoRoot, mark, restore }
}

export async function markServeSource(): Promise<SourceMark> {
  const repoRoot = (
    await git({ cwd: import.meta.dirname, argv: ['rev-parse', '--show-toplevel'] })
  ).trim()
  return markSourceAt({ repoRoot })
}
