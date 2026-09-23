export type CommandRun = { ok: boolean; stdout: string; stderr: string }

export type CommandRunner = (args: {
  command: readonly string[]
  cwd: string
}) => Promise<CommandRun>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const runCommand: CommandRunner = async ({ command, cwd }) => {
  try {
    const spawned = Bun.spawn([...command], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })
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
