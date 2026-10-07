export async function liveGitRaw(args: { cwd: string; args: readonly string[] }): Promise<string> {
  const process = Bun.spawn(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args.args], {
    cwd: args.cwd,
    env: { ...globalThis.process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0' },
    stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited])
  if (exit !== 0) throw new Error(`git ${args.args.join(' ')} failed: ${stderr}`)
  return stdout
}

export async function liveGit(args: { cwd: string; args: readonly string[] }): Promise<string> {
  return (await liveGitRaw(args)).trim()
}
