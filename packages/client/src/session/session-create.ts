import type {
  ESandboxProvider,
  SessionCreateInput,
  SessionMessageDraft,
} from '@dltech/atlas-protocol'

export const sessionCreateInputOf = (args: {
  projectId?: string | null | undefined
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
  provider?: ESandboxProvider | undefined
  firstMessage: SessionMessageDraft
}): SessionCreateInput => ({
  ...(args.projectId === null || args.projectId === undefined ? {} : { projectId: args.projectId }),
  ...(args.model === undefined ? {} : { model: args.model }),
  ...(args.effort === undefined ? {} : { effort: args.effort }),
  ...(args.fast === undefined ? {} : { fast: args.fast }),
  ...(args.provider === undefined ? {} : { provider: args.provider }),
  firstMessage: args.firstMessage,
})

export const initialProjectIdOf = (args: {
  projects: readonly { id: string }[]
  preselected: string | null | undefined
}): string | null => {
  const preselected = args.projects.find((project) => project.id === args.preselected)
  return preselected?.id ?? args.projects[0]?.id ?? null
}
