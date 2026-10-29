import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'
import { EServeEvent, type ServeLogLine } from '../serve-log'

import { trpcOk, trpcProcedureOf } from './trpc-fake'

const API = 'https://api.example.com'
const PROJECT_ID = 'proj-no-github'
const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const projectFetch = (githubToken: string | null): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (trpcProcedureOf(url.split('?')[0] ?? url) !== 'projectWorkspace.get') {
      return new Response('{}', { status: 404 })
    }
    return trpcOk({
      projectId: PROJECT_ID,
      repo: 'octocat/Hello-World',
      baseBranch: 'main',
      additionalRepos: [],
      githubToken,
    })
  }) as unknown as typeof fetch

const bootWithProject = async (githubToken: string | null) => {
  const atlasHome = mkdtempSync(join(tmpdir(), 'atlas-github-token-absent-'))
  homes.push(atlasHome)
  mkdirSync(join(atlasHome, 'bootstrap'), { recursive: true })
  writeFileSync(
    join(atlasHome, 'bootstrap', 'workspace-spec.json'),
    JSON.stringify({ remoteUrl: null, githubToken: null, projectId: PROJECT_ID }),
  )
  const lines: ServeLogLine[] = []
  const env: Record<string, string | undefined> = {}
  await bootServeFiles({
    env,
    threadId: toThreadId('thread-github-token-absent'),
    cwd: atlasHome,
    atlasHome,
    log: (line) => lines.push(line),
    ensureWorkspace: async ({ fetchSpec }) => {
      await fetchSpec()
      return { state: EWorkspaceState.Skipped }
    },
    controlPlaneUrl: API,
    token: 'pod-token',
    clientVersion: 'dev',
    fetchFn: projectFetch(githubToken),
  })
  return { lines, env }
}

describe('a pod whose Project comes back without a GitHub token', () => {
  it('logs that gh and git push have no credentials, naming the project', async () => {
    const { lines, env } = await bootWithProject(null)

    expect(env.GH_TOKEN).toBeUndefined()
    expect(lines).toContainEqual({ event: EServeEvent.GithubTokenAbsent, projectId: PROJECT_ID })
  })

  it('stays quiet when the token arrives and arms GH_TOKEN', async () => {
    const { lines, env } = await bootWithProject('gho_fixture')

    expect(env.GH_TOKEN).toBe('gho_fixture')
    expect(lines.some((line) => line.event === EServeEvent.GithubTokenAbsent)).toBe(false)
  })
})
