import { messageInputOf } from '@dltech/atlas-client/session'
import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import type { SessionMessageDraft } from '@dltech/atlas-protocol'

import {
  EProjectAnswer,
  EProjectPrompt,
  type ProjectAnswer,
  type ProjectChoice,
  type ProjectRequest,
} from '../ui/project-prompt-model'
import { githubRepoOfOrigin, matchProject } from './project-match'
import type { ProjectSaveBody } from './session-api'

export type ProjectApi = {
  listProjects: () => Promise<readonly ProjectChoice[]>
  createProject: (input: ProjectSaveBody) => Promise<ProjectChoice>
}

export type GitRemote = {
  readOriginUrl: (args: { cwd: string }) => Promise<string | null>
  remoteDefaultBranch: (args: { cwd: string }) => Promise<string | null>
}

export type ProjectResolution = { projectId: string | null } | 'cancelled'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const repoNameOf = (repo: string): string => repo.split('/')[1] ?? repo

const ALWAYS_MOUNTED = (): boolean => true

const createdOn = async (args: {
  projects: ProjectApi
  repo: string
  answer: ProjectAnswer
  isMounted: () => boolean
}): Promise<ProjectResolution> => {
  const { answer } = args
  if (answer.kind !== EProjectAnswer.Create || !args.isMounted()) return 'cancelled'

  try {
    const project = await args.projects.createProject({
      name: answer.name,
      repo: args.repo,
      baseBranch: answer.baseBranch,
      additionalRepos: [],
    })
    return args.isMounted() ? { projectId: project.id } : 'cancelled'
  } catch (failure) {
    throw new Error(`could not create the project — ${messageOf(failure)}`)
  }
}

export const resolveProjectOf = async (args: {
  cwd: string
  projects: ProjectApi
  git: GitRemote
  ask: (request: ProjectRequest) => Promise<ProjectAnswer>
  isMounted?: (() => boolean) | undefined
}): Promise<ProjectResolution> => {
  const isMounted = args.isMounted ?? ALWAYS_MOUNTED

  const origin = await args.git.readOriginUrl({ cwd: args.cwd })
  const repo = origin === null ? null : githubRepoOfOrigin({ originUrl: origin })

  let projects: readonly ProjectChoice[]
  try {
    projects = await args.projects.listProjects()
  } catch (failure) {
    throw new Error(`could not load your projects — ${messageOf(failure)}`)
  }
  if (!isMounted()) return 'cancelled'

  if (repo === null) {
    const answer = await args.ask({ mode: EProjectPrompt.Pick, projects })
    return answer.kind === EProjectAnswer.Pick ? { projectId: answer.projectId } : 'cancelled'
  }

  const match = matchProject({ projects, repo })
  if (match !== undefined) return { projectId: match.id }

  const baseBranch = (await args.git.remoteDefaultBranch({ cwd: args.cwd })) ?? ''
  if (!isMounted()) return 'cancelled'
  const answer = await args.ask({
    mode: EProjectPrompt.Create,
    repo,
    name: repoNameOf(repo),
    baseBranch,
  })
  return createdOn({ projects: args.projects, repo, answer, isMounted })
}

export const firstMessageOf = (args: {
  text: string
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): SessionMessageDraft => messageInputOf(args)
