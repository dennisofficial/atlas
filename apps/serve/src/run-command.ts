export type CommandRun = { ok: boolean; stdout: string; stderr: string }

export type CommandRunner = (args: {
  command: readonly string[]
  cwd: string
  stdin?: string | undefined
}) => Promise<CommandRun>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const runCommand: CommandRunner = async ({ command, cwd, stdin }) => {
  try {
    const spawned = Bun.spawn([...command], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdin === undefined ? 'ignore' : 'pipe',
    })
    if (stdin !== undefined) {
      const sink = spawned.stdin
      if (sink === undefined) throw new Error('the stdin pipe did not open')
      await sink.write(stdin)
      sink.end()
    }
    const [stdout, stderr, status] = await Promise.all([
      new Response(spawned.stdout).text(),
      new Response(spawned.stderr).text(),
      spawned.exited,
    ])
    return { ok: status === 0, stdout, stderr }
  } catch (error) {
    return { ok: false, stdout: '', stderr: messageOf(error) }
  }
}
