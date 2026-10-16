const GIT_IDENTITY = [
  '-c', 'user.name=Fixture',
  '-c', 'user.email=fixture@example.com',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.fsmonitor=false',
  '-c', 'maintenance.auto=false',
] as const

const cleanEnvironment = (): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value
  }
  env['GIT_CONFIG_GLOBAL'] = '/dev/null'
  env['GIT_CONFIG_NOSYSTEM'] = '1'
  return env
}

export async function git({ args, cwd }: { args: readonly string[]; cwd: string }): Promise<string> {
  const proc = Bun.spawn(['git', ...GIT_IDENTITY, ...args], {
    cwd,
    env: cleanEnvironment(),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr}`)
  return stdout.trim()
}
