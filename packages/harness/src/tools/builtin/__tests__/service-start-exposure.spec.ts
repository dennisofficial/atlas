import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { toThreadId, type ProcessPort, type ToolOutcome } from '@dltech/atlas-core'

import { LocalProcessPort } from '../../../execution/local-process'
import { BunServiceRegistry } from '../../../services/service-registry'
import { SystemClock } from '../../../store'
import { ServiceStartTool } from '../service-start'

const THREAD = toThreadId('thread-1')

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-service-exposure-'))
})

const registries: BunServiceRegistry[] = []

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
})

const openTool = (processes: ProcessPort = new LocalProcessPort()) => {
  const registry = new BunServiceRegistry({
    root,
    clock: new SystemClock(),
    logsDirectory: join(root, `logs-${crypto.randomUUID()}`),
    processes,
  })
  registries.push(registry)
  return { tool: new ServiceStartTool(registry, processes), registry }
}

const invoke = (tool: ServiceStartTool, input: Record<string, unknown>): Promise<ToolOutcome> =>
  tool.invoke({
    input: { command: 'sleep 30', description: 'Exercise the service', ...input },
    signal: new AbortController().signal,
    idempotencyKey: `service-exposure-${crypto.randomUUID()}`,
    projectDirectory: root,
    threadId: THREAD,
  })

describe('exposing a port from a service', () => {
  it('starts an exposed service with the mapping in the output and the URL in modelText', async () => {
    const { tool, registry } = openTool()

    const outcome = await invoke(tool, { exposePort: 3000 })
    if (!outcome.ok) throw new Error(outcome.reason)

    expect(outcome.output).toMatchObject({
      exposure: { containerPort: 3000, hostPort: 3000, url: 'http://localhost:3000' },
    })
    expect(outcome.modelText).toContain('http://localhost:3000')
    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]?.exposure).toEqual({
      containerPort: 3000,
      hostPort: 3000,
      url: 'http://localhost:3000',
    })
  })

  it('asks for the name before the command, so a row is named while the command still streams', () => {
    const { inputSchema } = openTool().tool
    const declared = z.toJSONSchema(inputSchema)

    expect(Object.keys(declared.properties ?? {})[0]).toBe('description')
  })

  it('leaves a start without exposePort untouched', async () => {
    const { tool } = openTool()

    const outcome = await invoke(tool, {})
    if (!outcome.ok) throw new Error(outcome.reason)

    expect(outcome.output).not.toHaveProperty('exposure')
    expect(outcome.modelText).not.toContain('reachable from this machine')
  })

  it('refuses when the execution port cannot publish ports, before anything starts', async () => {
    const bare: ProcessPort = {
      spawn: () => {
        throw new Error('unused')
      },
      which: () => null,
    }
    const { tool, registry } = openTool(bare)

    const outcome = await invoke(tool, { exposePort: 3000 })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('publish')
    expect(registry.list()).toHaveLength(0)
  })
})

describe('the service env contract', () => {
  it('runs the service with PORT from port, else exposePort', async () => {
    const spawned: Array<Record<string, string | undefined> | undefined> = []
    const local = new LocalProcessPort()
    const spy: ProcessPort = {
      spawn: (args) => {
        if (args.cmd[2] === 'sleep 30') spawned.push(args.env)
        return local.spawn(args)
      },
      which: (args) => local.which(args),
      exposePort: (args) => local.exposePort!(args),
    }
    const { tool } = openTool(spy)

    await invoke(tool, { port: 24_000 })
    await invoke(tool, { exposePort: 3100 })

    expect(spawned[0]?.PORT).toBe('24000')
    expect(spawned[0]?.PUBLIC_URL).toBeUndefined()
    expect(spawned[1]?.PORT).toBe('3100')
    expect(spawned[1]?.PUBLIC_URL).toBe('http://localhost:3100')
    expect(spawned[1]?.ATLAS_THREAD_ID).toBe('thread-1')
  })
})
