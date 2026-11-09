import type { ProcessPort } from '@dltech/atlas-core'

export type GitRun = { ok: boolean; stdout: string; stderr: string }

const MESSAGE_LIMIT = 400

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const textOf = (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text()

export const runGit = async (args: {
  processes: ProcessPort
  cwd: string
  argv: readonly string[]
}): Promise<GitRun> => {
  try {
    const handle = args.processes.spawn({ cmd: ['git', ...args.argv], cwd: args.cwd })
    const [stdout, stderr, code] = await Promise.all([
      textOf(handle.stdout),
      textOf(handle.stderr),
      handle.exited,
    ])
    return { ok: code === 0, stdout, stderr }
  } catch (error) {
    return { ok: false, stdout: '', stderr: messageOf(error) }
  }
}

const readable = (text: string): string => {
  const joined = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('; ')
  return joined.length > MESSAGE_LIMIT ? `${joined.slice(0, MESSAGE_LIMIT)}…` : joined
}

export const complaintOf = (run: GitRun): string => {
  const spoken = readable(run.stderr.length > 0 ? run.stderr : run.stdout)
  return spoken.length === 0 ? 'git exited without saying why' : spoken
}
