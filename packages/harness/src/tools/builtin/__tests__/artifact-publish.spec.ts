import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolDefinition, type ToolOutcome } from '@dltech/atlas-core'
import { sha256Hex } from '@dltech/atlas-artifacts'

import { ArtifactUnavailable } from '../../../artifacts/artifact-port'
import { PublishArtifactTool } from '../artifact-publish'

import { FakeArtifactPort, FakeFiles, FakeProcesses } from './artifact-fakes'

const indexHtml = '<!doctype html><title>demo</title>'
const appJs = 'console.log("demo")'
const exampleEnv = 'TOKEN='

type FetchCall = { url: string; method: string | undefined }

const rigOf = (args?: { paths?: readonly string[]; spec?: unknown; prefix?: string }) => {
  const prefix = args?.prefix ?? '/ws'
  const port = new FakeArtifactPort()
  const files = new FakeFiles()
  const processes = new FakeProcesses()
  const calls: FetchCall[] = []
  const contents = new Map<string, string>([
    ['/ws/index.html', indexHtml],
    ['/ws/app.js', appJs],
    ['/ws/.env', 'SECRET=hunter2'],
    ['/ws/.env.local', 'SECRET=hunter2'],
    ['/ws/.env.example', exampleEnv],
    ['/ws/node_modules/dep/index.js', 'module.exports = 1'],
    ['/ws/.git/config', '[core]'],
    ['/ws/untracked-but-present.txt', 'not shipped'],
  ])
  for (const [path, content] of contents) {
    files.put(`${prefix}${path.slice('/ws'.length)}`, content)
  }
  if (args?.spec !== undefined) files.put(`${prefix}/artifact.json`, JSON.stringify(args.spec))
  processes.gitListing(
    args?.paths ?? [
      ...(args?.spec === undefined ? [] : ['artifact.json']),
      'index.html',
      'app.js',
      '.env',
      '.env.local',
      '.env.example',
      'node_modules/dep/index.js',
      '.git/config',
    ],
  )
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method })
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch
  const tool = new PublishArtifactTool({ port, processes, files, fetchFn })
  return { port, files, processes, calls, tool }
}

const invoke = async (input: Record<string, unknown>, tool: ToolDefinition) =>
  await tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/ws',
    threadId: toThreadId('thr_1'),
  } as never)

const modelTextOf = (outcome: ToolOutcome): string => {
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.modelText
}

describe('artifact_publish', () => {
  it('sends exactly the selected entries with their hashes', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    const [begin] = rig.port.beginCalls
    expect(begin?.entries.map((entry) => entry.path)).toEqual([
      '.env.example',
      'app.js',
      'index.html',
    ])
    const html = begin?.entries.find((entry) => entry.path === 'index.html')
    expect(html).toMatchObject({
      tree: 'src',
      size: new TextEncoder().encode(indexHtml).byteLength,
      sha256: sha256Hex(new TextEncoder().encode(indexHtml)),
      type: 'text/html; charset=utf-8',
    })
    expect(rig.port.commitCalls).toHaveLength(1)
  })

  it('never publishes a .env file but does publish .env.example', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    const paths = rig.port.beginCalls[0]?.entries.map((entry) => entry.path) ?? []
    expect(paths).not.toContain('.env')
    expect(paths).not.toContain('.env.local')
    expect(paths).toContain('.env.example')
  })

  it('never publishes a hard-excluded path', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    const paths = rig.port.beginCalls[0]?.entries.map((entry) => entry.path) ?? []
    expect(paths).not.toContain('node_modules/dep/index.js')
    expect(paths).not.toContain('.git/config')
    expect(paths).not.toContain('untracked-but-present.txt')
  })

  it('PUTs only the presigned uploads, once each', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    expect(rig.calls.map((call) => call.url).sort()).toEqual([
      'https://upload.test/.env.example',
      'https://upload.test/app.js',
      'https://upload.test/index.html',
    ])
    expect(rig.calls.every((call) => call.method === 'PUT')).toBe(true)
  })

  it('reads artifact.json and applies its exclude list', async () => {
    const rig = rigOf({ spec: { serve: { spa: true }, publish: { exclude: ['app.js'] } } })
    modelTextOf(await invoke({}, rig.tool))

    const paths = rig.port.beginCalls[0]?.entries.map((entry) => entry.path) ?? []
    expect(paths).not.toContain('app.js')
    expect(rig.port.commitCalls[0]?.spec).toMatchObject({ serve: { spa: true } })
  })

  it('asks git for tracked and unignored files in the chosen directory', async () => {
    const rig = rigOf({ prefix: '/ws/site' })
    modelTextOf(await invoke({ dir: 'site' }, rig.tool))

    expect(rig.processes.commands[0]).toEqual([
      'git',
      '-C',
      '/ws/site',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ])
  })

  it('reports a directory that git cannot list as prose', async () => {
    const rig = rigOf()
    rig.processes.exitCode = 128
    rig.processes.stderr = 'fatal: not a git repository'

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('git worktree')
  })

  it('turns a port error into prose rather than throwing', async () => {
    const rig = rigOf()
    rig.port.failure = new ArtifactUnavailable('sign in to Atlas Cloud to publish artifacts')

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('sign in to Atlas Cloud')
    expect(rig.calls).toHaveLength(0)
  })

  it('states the URL and version it published', async () => {
    const rig = rigOf()
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(text).toContain('https://demo.artifacts.test')
    expect(text).toContain('version 3')
  })
})
