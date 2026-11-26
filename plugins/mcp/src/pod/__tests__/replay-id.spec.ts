import { describe, expect, it } from 'bun:test'

import { rig } from './rig'
import { StdioClient } from '../stdio'
import { fakeDaemon } from './support'

const TRANSPORT = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const SEARCH = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
}

const scopeHarnessOf = (daemon: ReturnType<typeof fakeDaemon>) => {
  const counters = new Map<string, number>()
  let scope = 'warm'
  const ctx = {
    ...rig(daemon),
    replayStableId: (): string => {
      const index = counters.get(scope) ?? 0
      counters.set(scope, index + 1)
      return `${scope}#${index}`
    },
  }
  return {
    client: new StdioClient({ ctx, serverId: 'docs', transport: TRANSPORT }),
    enter: (key: string): void => {
      scope = key
    },
  }
}

const lineAt = (daemon: ReturnType<typeof fakeDaemon>, at: number): string | undefined =>
  daemon.sends[at]?.line

describe('the correlation id an MCP client writes', () => {
  it('repeats for the same request in the same call scope, from a recreated client', async () => {
    const daemon = fakeDaemon({ docs: { tools: [SEARCH] } })

    const first = scopeHarnessOf(daemon)
    await first.client.connect()
    await first.client.callTool({ name: 'search', input: { q: 'warm' } })
    first.enter('call-1')
    const beforeFirst = daemon.sends.length
    await first.client.callTool({ name: 'search', input: { q: 'q' } })

    const second = scopeHarnessOf(daemon)
    await second.client.connect()
    second.enter('call-1')
    const beforeSecond = daemon.sends.length
    await second.client.callTool({ name: 'search', input: { q: 'q' } })

    const replayed = lineAt(daemon, beforeFirst)
    expect(replayed).toBeDefined()
    expect(lineAt(daemon, beforeSecond)).toBe(replayed)
    expect(JSON.parse(replayed ?? '{}').id).toBe('call-1#0')
  })
})
