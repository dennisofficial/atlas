import { workloadCommand } from '@dltech/atlas-harness'

export type CommandRun = { ok: boolean; stdout: string; stderr: string }

export type CommandRunner = (args: {
  command: readonly string[]
  cwd: string
  stdin?: string | undefined
  env?: Record<string, string> | undefined
  timeoutMs?: number | undefined
}) => Promise<CommandRun>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const TIMED_OUT = Symbol('timed-out')

const collect = (
  stream: ReadableStream<Uint8Array>,
): { text: () => string; done: Promise<void> } => {
  const decoder = new TextDecoder()
  let text = ''
  const done = (async () => {
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true })
  })().catch(() => undefined)
  return { text: () => text, done }
}

const minutesText = (timeoutMs: number): string => {
  const minutes = timeoutMs / 60_000
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(2)} minutes`
}

export const runCommand: CommandRunner = async ({ command, cwd, stdin, env, timeoutMs }) => {
  try {
    const spawned = Bun.spawn(
      workloadCommand({ cmd: command, cwd, env: { ...process.env, ...env } }),
      {
        cwd,
        ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: stdin === undefined ? 'ignore' : 'pipe',
      },
    )
    if (stdin !== undefined) {
      const sink = spawned.stdin
      if (sink === undefined) throw new Error('the stdin pipe did not open')
      await sink.write(stdin)
      sink.end()
    }
    const stdout = collect(spawned.stdout)
    const stderr = collect(spawned.stderr)
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry =
      timeoutMs === undefined
        ? new Promise<never>(() => undefined)
        : new Promise<typeof TIMED_OUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
          })
    const finished = Promise.all([stdout.done, stderr.done, spawned.exited])
    const raced = await Promise.race([finished, expiry])
    clearTimeout(timer)
    if (raced === TIMED_OUT && timeoutMs !== undefined) {
      spawned.kill('SIGKILL')
      const note = `timed out after ${minutesText(timeoutMs)}`
      const output = stderr.text()
      return {
        ok: false,
        stdout: stdout.text(),
        stderr: `${output}${output === '' || output.endsWith('\n') ? '' : '\n'}${note}`,
      }
    }
    return {
      ok: spawned.exitCode === 0,
      stdout: stdout.text(),
      stderr: stderr.text(),
    }
  } catch (error) {
    return { ok: false, stdout: '', stderr: messageOf(error) }
  }
}
