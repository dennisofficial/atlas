import { describe, expect, test } from 'bun:test'

import {
  EProjectAnswer,
  EProjectPrompt,
  type ProjectAnswer,
  type ProjectChoice,
  type ProjectRequest,
} from '../../ui/project-prompt-model'
import { firstMessageOf, resolveProjectOf, type GitRemote, type ProjectApi } from '../new-session'

const PROJECT: ProjectChoice = {
  id: 'project-1',
  name: 'b',
  repo: 'a/b',
  updatedAt: '2026-11-01T00:00:00.000Z',
}

const projectApiOf = (args: {
  projects: readonly ProjectChoice[]
  created?: ProjectChoice[]
}): ProjectApi => ({
  listProjects: async () => args.projects,
  createProject: async (input) => {
    args.created?.push({
      id: 'project-new',
      name: input.name,
      repo: input.repo,
      updatedAt: '2026-11-20T00:00:00.000Z',
    })
    return {
      id: 'project-new',
      name: input.name,
      repo: input.repo,
      updatedAt: '2026-11-20T00:00:00.000Z',
    }
  },
})

const gitOf = (args: { originUrl: string | null; branch?: string | null }): GitRemote => ({
  readOriginUrl: async () => args.originUrl,
  remoteDefaultBranch: async () => args.branch ?? null,
})

const neverAsked = async (): Promise<ProjectAnswer> => {
  throw new Error('the operator should not have been asked')
}

describe('resolveProjectOf', () => {
  test('a matching remote resolves the project without asking', async () => {
    const resolved = await resolveProjectOf({
      cwd: '/clone',
      projects: projectApiOf({ projects: [PROJECT] }),
      git: gitOf({ originUrl: 'git@github.com:a/b.git' }),
      ask: neverAsked,
      isMounted: () => true,
    })
    expect(resolved).toEqual({ projectId: 'project-1' })
  })

  test('an unmatched remote asks for a project and creates it', async () => {
    const created: ProjectChoice[] = []
    const asked: ProjectRequest[] = []
    const ask = async (request: ProjectRequest): Promise<ProjectAnswer> => {
      asked.push(request)
      return { kind: EProjectAnswer.Create, name: 'fresh', baseBranch: 'trunk' }
    }

    const resolved = await resolveProjectOf({
      cwd: '/clone',
      projects: projectApiOf({ projects: [], created }),
      git: gitOf({ originUrl: 'git@github.com:a/new.git', branch: 'main' }),
      ask,
      isMounted: () => true,
    })

    expect(asked).toHaveLength(1)
    expect(asked[0]?.mode).toBe(EProjectPrompt.Create)
    expect(created).toHaveLength(1)
    expect(resolved).toEqual({ projectId: 'project-new' })
  })

  test('a cancelled drawer creates nothing', async () => {
    const created: ProjectChoice[] = []
    const resolved = await resolveProjectOf({
      cwd: '/clone',
      projects: projectApiOf({ projects: [], created }),
      git: gitOf({ originUrl: 'git@github.com:a/new.git' }),
      ask: async () => ({ kind: EProjectAnswer.Cancelled }),
      isMounted: () => true,
    })

    expect(resolved).toBe('cancelled')
    expect(created).toHaveLength(0)
  })

  test('a drawer that closes after the create returns cancelled', async () => {
    let mounted = true
    const projects: ProjectApi = {
      listProjects: async () => [],
      createProject: async (input) => {
        mounted = false
        return { id: 'project-new', name: input.name, repo: input.repo, updatedAt: '2026-11-20' }
      },
    }

    const resolved = await resolveProjectOf({
      cwd: '/clone',
      projects,
      git: gitOf({ originUrl: 'git@github.com:a/new.git' }),
      ask: async () => ({ kind: EProjectAnswer.Create, name: 'fresh', baseBranch: null }),
      isMounted: () => mounted,
    })

    expect(resolved).toBe('cancelled')
  })

  test('a repository-less clone asks which project this is', async () => {
    const asked: ProjectRequest[] = []
    const resolved = await resolveProjectOf({
      cwd: '/clone',
      projects: projectApiOf({ projects: [PROJECT] }),
      git: gitOf({ originUrl: null }),
      ask: async (request) => {
        asked.push(request)
        return { kind: EProjectAnswer.Pick, projectId: 'project-1' }
      },
      isMounted: () => true,
    })

    expect(asked[0]?.mode).toBe(EProjectPrompt.Pick)
    expect(resolved).toEqual({ projectId: 'project-1' })
  })
})

describe('firstMessageOf', () => {
  test('carries the text and no attachments when there are none', () => {
    expect(firstMessageOf({ text: 'hello', media: [], uploads: [] })).toEqual({ text: 'hello' })
  })
})
