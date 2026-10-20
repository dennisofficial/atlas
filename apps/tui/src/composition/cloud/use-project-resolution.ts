import { useCallback, useRef } from 'react'

import { githubRepoOfOrigin, matchProject, readOriginUrl, remoteDefaultBranch, type CloudClient } from '@dltech/atlas-harness'

import { messageOf } from '../error-text'
import { EProjectAnswer, EProjectPrompt, type ProjectAnswer, type ProjectRequest } from '../../ui/project-prompt-model'
import type { AtlasApp } from '../compose'
import type { ProjectPromptControl } from '../use-project-prompt'

export type ProjectResolution = { projectId: string | null } | 'cancelled'

const NO_CLIENT = 'could not load your projects — Atlas Cloud is not reachable'

const repoNameOf = (repo: string): string => repo.split('/')[1] ?? repo

async function listed(client: CloudClient) {
  try {
    return await client.listProjects()
  } catch (error) {
    throw new Error(`could not load your projects — ${messageOf(error)}`)
  }
}

const ALWAYS_MOUNTED = (): boolean => true

async function createdOn(args: {
  client: CloudClient
  repo: string
  answer: ProjectAnswer
  isMounted: () => boolean
}): Promise<ProjectResolution> {
  const { answer } = args
  if (answer.kind !== EProjectAnswer.Create || !args.isMounted()) return 'cancelled'
  try {
    const project = await args.client.createProject({
      name: answer.name,
      repo: args.repo,
      baseBranch: answer.baseBranch,
      additionalRepos: [],
    })
    return args.isMounted() ? { projectId: project.id } : 'cancelled'
  } catch (error) {
    throw new Error(`could not create the project — ${messageOf(error)}`)
  }
}

export async function resolveProject(args: {
  cwd: string
  client: CloudClient | null
  ask: (request: ProjectRequest) => Promise<ProjectAnswer>
  isMounted?: () => boolean
}): Promise<ProjectResolution> {
  const { client, cwd } = args
  const isMounted = args.isMounted ?? ALWAYS_MOUNTED
  if (client === null) throw new Error(NO_CLIENT)

  const origin = await readOriginUrl({ cwd })
  const repo = origin === null ? null : githubRepoOfOrigin(origin)
  const projects = await listed(client)
  if (!isMounted()) return 'cancelled'

  if (repo === null) {
    const answer = await args.ask({ mode: EProjectPrompt.Pick, projects })
    return answer.kind === EProjectAnswer.Pick ? { projectId: answer.projectId } : 'cancelled'
  }

  const match = matchProject({ projects, repo })
  if (match !== undefined) return { projectId: match.id }

  const baseBranch = (await remoteDefaultBranch({ cwd })) ?? ''
  if (!isMounted()) return 'cancelled'
  const answer = await args.ask({ mode: EProjectPrompt.Create, repo, name: repoNameOf(repo), baseBranch })
  return createdOn({ client, repo, answer, isMounted })
}

export function useProjectResolution(args: {
  app: Pick<AtlasApp, 'cloud' | 'config'>
  prompt: Pick<ProjectPromptControl, 'ask' | 'isMounted'>
}): () => Promise<ProjectResolution> {
  const latest = useRef(args)
  latest.current = args

  return useCallback(() => {
    const { app, prompt } = latest.current
    return resolveProject({ cwd: app.config.cwd, client: app.cloud.client(), ask: prompt.ask, isMounted: prompt.isMounted })
  }, [])
}
