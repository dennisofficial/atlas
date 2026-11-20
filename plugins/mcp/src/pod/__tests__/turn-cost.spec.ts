import { toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { type McpCloudRow } from '../../core'
import { mcpPod } from '..'
import { fakeDaemon, rig, type FakeBehaviour } from './support'

const docsTransport = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const searchTool = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
}

const row = (name: string): McpCloudRow => ({
  source: 'user',
  spec: { name, transport: docsTransport },
})

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const behaviours = (names: readonly string[]): Record<string, FakeBehaviour> =>
  Object.fromEntries(names.map((name) => [name, { tools: [searchTool] }]))

const racing = async (args: { run: () => Promise<unknown>; ms: number }): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('waited'), args.ms)
  })
  try {
    return await Promise.race([args.run().then(() => 'returned'), late])
  } finally {
    clearTimeout(timer)
  }
}

const settled = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('the MCP servers never settled')
}

const podFor = (args: {
  daemon: ReturnType<typeof fakeDaemon>
  read: () => Promise<{ rows: readonly McpCloudRow[]; rejections: readonly never[] }>
}) => {
  const ctx = rig(args.daemon)
  const pod = mcpPod({ config: { read: args.read } })
  const hook = pod.hooks?.(ctx)?.beforeTurn?.[0]
  if (hook === undefined) throw new Error('the mcp pod registered no before-turn hook')
  return {
    ctx,
    pod,
    run: async (): Promise<void> => {
      await hook.run({ threadId: toThreadId('t1'), projectDirectory: '/repo' })
    },
    names: (): readonly string[] =>
      (pod.tools?.(ctx) ?? []).map((tool) => tool.name).filter((name) => name.startsWith('mcp__')),
  }
}

describe('a turn after the first', () => {
  it('returns before the config has been re-read, and a server that appears later is offered', async () => {
    const daemon = fakeDaemon(behaviours(['docs', 'late']))
    const second = deferred<{ rows: readonly McpCloudRow[]; rejections: readonly never[] }>()
    let reads = 0
    const { run, names } = podFor({
      daemon,
      read: async () => {
        reads += 1
        if (reads === 1) return { rows: [row('docs')], rejections: [] }
        return await second.promise
      },
    })

    await run()
    expect(names()).toEqual(['mcp__docs__search'])

    expect(await racing({ run, ms: 100 })).toBe('returned')
    expect(reads).toBe(2)

    second.resolve({ rows: [row('docs'), row('late')], rejections: [] })
    await settled(() => names().length === 2)
    expect(names()).toEqual(['mcp__docs__search', 'mcp__late__search'])
  })

  it('picks up a server added between two turns that no turn waited for', async () => {
    const daemon = fakeDaemon(behaviours(['docs', 'late']))
    let rows: readonly McpCloudRow[] = [row('docs')]
    const { run, names } = podFor({ daemon, read: async () => ({ rows, rejections: [] }) })

    await run()
    rows = [row('docs'), row('late')]
    await run()
    await settled(() => names().length === 2)

    expect(names()).toEqual(['mcp__docs__search', 'mcp__late__search'])
  })
})
