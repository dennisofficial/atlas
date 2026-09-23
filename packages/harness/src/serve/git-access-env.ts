import { gitConfigEnv } from '../workspace/git-config-env'

/**
 * The workspace spec's brokered token is the one github credential a cloud sandbox provably has;
 * it rides the serve's own environment (process.env in production) so every child process — the
 * agent's shells included — inherits gh access, mirroring what a docker sandbox gets at creation.
 */
export const applyGitAccessEnv = (args: {
  env: Record<string, string | undefined>
  cwd: string
  githubToken: string | null | undefined
}): void => {
  if (args.githubToken === null || args.githubToken === undefined || args.githubToken === '') return
  const githubToken = args.githubToken
  args.env.GH_TOKEN = githubToken
  for (const entry of gitConfigEnv({ worktree: args.cwd, githubToken })) {
    const at = entry.indexOf('=')
    args.env[entry.slice(0, at)] = entry.slice(at + 1)
  }
}
