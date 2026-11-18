import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import {
  readRecordedWorkspaceDir,
  resolveWorkspaceDir,
  workspaceDirRecordFile,
  writeRecordedWorkspaceDir,
} from '../workspace-dir'
import type { WorkspaceSpec } from '../workspace-spec'

import { trpcOk, trpcProcedureOf } from './trpc-fake'

const API = 'https://api.example.com'
const PROJECT_ID = 'proj-repo-dir'
const homes: string[] = []

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-workspace-dir-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  while (homes.length > 0) {
    const dir = homes.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const specWith = (remoteUrl: string | null): WorkspaceSpec => ({
  remoteUrl,
  githubToken: null,
  model: null,
})

const noWait = async (): Promise<void> => undefined

describe('readRecordedWorkspaceDir', () => {
  it('answers null when no record exists', async () => {
    expect(await readRecordedWorkspaceDir({ atlasHome: home() })).toBeNull()
  })

  it('round-trips a written record', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/atlas' })
    expect(await readRecordedWorkspaceDir({ atlasHome })).toBe('/atlas/workspaces/atlas')
  })

  it('answers null for a corrupt record', async () => {
    const atlasHome = home()
    const file = workspaceDirRecordFile({ atlasHome })
    await mkdir(join(atlasHome, 'operational'), { recursive: true })
    await writeFile(file, 'not json', 'utf8')
    expect(await readRecordedWorkspaceDir({ atlasHome })).toBeNull()
  })
})

describe('resolveWorkspaceDir', () => {
  it('names the workspace after the repo in the spec remote', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => specWith('https://github.com/dennisofficial/atlas'),
      sleep: noWait,
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })

  it('reads the repo name from an ssh remote too', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => specWith('git@github.com:dennisofficial/atlas.git'),
      sleep: noWait,
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })

  it('lands a no-remote thread in the launcher cwd', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => specWith(null),
      sleep: noWait,
    })
    expect(dir).toBe('/atlas/workspaces/workspace')
  })

  it('surfaces a spec that never arrives instead of landing in the launcher cwd', async () => {
    let attempts = 0
    const resolving = resolveWorkspaceDir({
      atlasHome: home(),
      sleep: noWait,
      fetchSpec: async () => {
        attempts += 1
        throw new Error('no spec')
      },
    })
    await expect(resolving).rejects.toThrow('the workspace spec never arrived after 3 attempts')
    expect(attempts).toBe(3)
  })

  it('refetches a spec that failed once and names the repo it then returns', async () => {
    const waits: number[] = []
    let attempts = 0
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      sleep: async (ms) => void waits.push(ms),
      fetchSpec: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('socket closed')
        return specWith('https://github.com/dennisofficial/atlas')
      },
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
    expect(attempts).toBe(2)
    expect(waits).toHaveLength(1)
  })

  it('replaces a stale placeholder record with the repo the spec names', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/workspace' })
    const dir = await resolveWorkspaceDir({
      atlasHome,
      fetchSpec: async () => specWith('https://github.com/dennisofficial/atlas'),
      sleep: noWait,
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })

  it('replaces a record naming another repo with the repo the spec names', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/old' })
    const dir = await resolveWorkspaceDir({
      atlasHome,
      fetchSpec: async () => specWith('https://github.com/dennisofficial/renamed'),
      sleep: noWait,
    })
    expect(dir).toBe('/atlas/workspaces/renamed')
  })

  it('keeps a repo-named record when the spec never arrives', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/atlas' })
    const dir = await resolveWorkspaceDir({
      atlasHome,
      sleep: noWait,
      fetchSpec: async () => {
        throw new Error('no spec')
      },
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })

  it('boots a resumed no-remote thread in its recorded dir', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/atlas' })
    const dir = await resolveWorkspaceDir({
      atlasHome,
      fetchSpec: async () => specWith(null),
      sleep: noWait,
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })
})

const projectFetch = (repo: string | null, status: number): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (trpcProcedureOf(url.split('?')[0] ?? url) !== 'projectWorkspace.get') {
      return new Response('{}', { status: 404 })
    }
    if (status !== 200) return new Response('{}', { status })
    return trpcOk({
      projectId: PROJECT_ID,
      repo,
      baseBranch: 'main',
      additionalRepos: [],
      githubToken: null,
    })
  }) as unknown as typeof fetch

const bootWith = async (args: {
  bootstrap: Record<string, unknown> | null
  fetchFn: typeof fetch
  recorded?: string | undefined
}) => {
  const atlasHome = home()
  if (args.bootstrap !== null) {
    mkdirSync(join(atlasHome, 'bootstrap'), { recursive: true })
    mkdirSync(join(atlasHome, 'operational'), { recursive: true })
    await writeFile(
      join(atlasHome, 'bootstrap', 'workspace-spec.json'),
      JSON.stringify(args.bootstrap),
      'utf8',
    )
  }
  if (args.recorded !== undefined) {
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: args.recorded })
  }
  const lines: ServeLogLine[] = []
  const result = await bootServeFiles({
    env: {},
    threadId: toThreadId('thread-workspace-dir'),
    cwd: atlasHome,
    atlasHome,
    log: (line) => lines.push(line),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    controlPlaneUrl: API,
    token: 'pod-token',
    clientVersion: 'dev',
    fetchFn: args.fetchFn,
  })
  return { result, lines, atlasHome }
}

describe('booting into a workspace dir', () => {
  it('moves a pod recorded at the placeholder to the repo the spec names', async () => {
    const { result, atlasHome } = await bootWith({
      bootstrap: { remoteUrl: null, githubToken: null, projectId: PROJECT_ID },
      fetchFn: projectFetch('octocat/Hello-World', 200),
      recorded: '/atlas/workspaces/workspace',
    })

    expect(result.activeCwd).toBe('/atlas/workspaces/Hello-World')
    expect(await readRecordedWorkspaceDir({ atlasHome })).toBe('/atlas/workspaces/Hello-World')
  })

  it('reports a workspace failure and records nothing when the spec never arrives', async () => {
    const { result, lines, atlasHome } = await bootWith({
      bootstrap: null,
      fetchFn: projectFetch('octocat/Hello-World', 200),
    })

    expect(result.workspace.state).toBe(EWorkspaceState.Failed)
    expect(lines).toContainEqual({
      event: EServeEvent.WorkspaceFailed,
      step: 'fetch',
      reason: expect.stringContaining('the workspace spec never arrived'),
      ms: expect.any(Number),
    })
    expect(await readRecordedWorkspaceDir({ atlasHome })).toBeNull()
  })
})
