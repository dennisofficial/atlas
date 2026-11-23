import { SANDBOX_HOME_PATH } from '@dltech/atlas-wire'

export const BOOTSTRAP_DIRECTORY = `${SANDBOX_HOME_PATH}/bootstrap`
export const WORKSPACE_SPEC_PATH = `${BOOTSTRAP_DIRECTORY}/workspace-spec.json`

export const bootstrapSpecOf = (args: {
  projectId: string | null
  model?: string | undefined
  effort?: string | undefined
}): string =>
  JSON.stringify({
    remoteUrl: null,
    githubToken: null,
    projectId: args.projectId,
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
  })
