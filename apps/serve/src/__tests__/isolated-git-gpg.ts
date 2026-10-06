import type { GitRunner } from '../materialize-workspace'
import type { CommandRunner } from '../run-command'

export type IsolatedEnv = Record<string, string>

export const isolatedEnv = (args: { home: string; gnupgHome: string }): IsolatedEnv => ({
  PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin',
  HOME: args.home,
  GNUPGHOME: args.gnupgHome,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
})

export const isolatedRunner =
  (env: IsolatedEnv): CommandRunner =>
  async ({ command, cwd, stdin }) => {
    const spawned = Bun.spawn([...command], {
      cwd,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdin === undefined ? 'ignore' : 'pipe',
    })
    if (stdin !== undefined && spawned.stdin !== undefined) {
      await spawned.stdin.write(stdin)
      spawned.stdin.end()
    }
    const [stdout, stderr, status] = await Promise.all([
      new Response(spawned.stdout).text(),
      new Response(spawned.stderr).text(),
      spawned.exited,
    ])
    return { ok: status === 0, stdout, stderr }
  }

export const isolatedGit = (env: IsolatedEnv): GitRunner => {
  const run = isolatedRunner(env)
  return ({ args, cwd }) => run({ command: ['git', ...args], cwd })
}
