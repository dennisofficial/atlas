import type { ApplyEnvironmentProfile, EnvironmentProfile } from './environment-profile'
import { applyGitAccessEnv } from './git-access-env'
import type { FetchWorkspaceSpec } from './workspace-spec'

export async function applyDirectProfile(args: {
  env: Record<string, string | undefined>
  cwd: string
  fetchSpec: FetchWorkspaceSpec
  profile: ApplyEnvironmentProfile
}): Promise<EnvironmentProfile | undefined> {
  try {
    const spec = await args.fetchSpec()
    applyGitAccessEnv({ env: args.env, cwd: args.cwd, githubToken: spec.githubToken })
    return await args.profile({ cwd: args.cwd, spec })
  } catch {
    return undefined
  }
}
