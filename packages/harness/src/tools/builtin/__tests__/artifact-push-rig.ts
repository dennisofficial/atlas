import { toThreadId, type ToolDefinition, type ToolOutcome } from '@dltech/atlas-core'

import { PushArtifactTool } from '../artifact-push'

import { FakeArtifactPort, FakeFiles, FakeProcesses } from './artifact-fakes'
import { FakeSubscriptionRegistry } from './subscription-fakes'

export const LINKED = 'k7f2m9qxabcd'

export const indexHtml = '<!doctype html><title>demo</title>'
const appJs = 'console.log("demo")'
const exampleEnv = 'TOKEN='

type FetchCall = { url: string; method: string | undefined }

export const rigOf = (args?: {
  paths?: readonly string[]
  spec?: unknown
  prefix?: string
  registry?: boolean
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
    calls.push({ url: String(input), method: init?.method })
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch
  const registry = new FakeSubscriptionRegistry()
  const tool = new PushArtifactTool({
    port,
    processes,
    files,
    fetchFn,
    ...(args?.registry === false ? {} : { registry: () => registry }),
  })
  return { port, files, processes, calls, registry, tool }
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
