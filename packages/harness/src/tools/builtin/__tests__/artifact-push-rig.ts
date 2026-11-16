import { toThreadId, type ToolDefinition, type ToolOutcome } from '@dltech/atlas-core'

import { PushArtifactTool } from '../artifact-push'

import { FakeArtifactPort, FakeFiles, FakeProcesses } from './artifact-fakes'

export const LINKED = 'k7f2m9qxabcd'

export const indexHtml = '<!doctype html><title>demo</title>'
const appJs = 'console.log("demo")'
const exampleEnv = 'TOKEN='

type FetchCall = { url: string; method: string | undefined; body: Uint8Array }

export const rigOf = (args?: {
  paths?: readonly string[]
  spec?: unknown
  prefix?: string
  output?: Record<string, string>
}) => {
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
    calls.push({
      url: String(input),
      method: init?.method,
      body: init?.body instanceof Uint8Array ? init.body : new Uint8Array(),
    })
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch
  for (const [path, content] of Object.entries(args?.output ?? {})) {
    files.put(`${prefix}/${path}`, content)
  }
  const tool = new PushArtifactTool({ port, processes, files, fetchFn })
  return { port, files, processes, calls, tool }
}

export const invoke = async (input: Record<string, unknown>, tool: ToolDefinition) =>
  await tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/ws',
    threadId: toThreadId('thr_1'),
  } as never)

export const modelTextOf = (outcome: ToolOutcome): string => {
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.modelText
}

export const reasonOf = (outcome: ToolOutcome): string => (outcome.ok ? '' : outcome.reason)
