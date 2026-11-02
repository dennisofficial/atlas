import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { LocalProcessPort } from '../../../execution/local-process'
import { parseDeclaredServices } from '../../../services/declared-services'
import { BunServiceRegistry } from '../../../services/service-registry'
import { SystemClock } from '../../../store'
import { ServiceListTool } from '../service-list'
import { ServiceRestartTool } from '../service-restart'
import { ServiceStartTool } from '../service-start'
import { ServiceStopTool } from '../service-stop'

const THREAD = toThreadId('thread-ensure-tools')
const registries: BunServiceRegistry[] = []
afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.closeAll()))
})

const SERVER = "Bun.serve({ port: 24777, fetch: () => new Response('ok') })"
const YAML = `services:\n  napper:\n    command: ${JSON.stringify(`bun -e "${SERVER}"`)}\n    port: 24777\n`

const open = async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-ensure-tools-'))
  const registry = new BunServiceRegistry({
    root,
    clock: new SystemClock(),
    logsDirectory: join(root, 'logs'),
    processes: new LocalProcessPort(),
    declared: {
      load: async () => parseDeclaredServices({ text: YAML, file: 'x' }),
      timing: { budgetMs: 5000, intervalMs: 20 },
    },
  })
  registries.push(registry)
  return { registry, root }
}

const run = (tool: { invoke: (a: never) => Promise<ToolOutcome> }, root: string, input: object) =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: `k-${crypto.randomUUID()}`,
    projectDirectory: root,
    threadId: THREAD,
  } as never)

describe('name-addressed service tools', () => {
  it('starts by name, lists by name, restarts by name and stops by name', async () => {
    const { registry, root } = await open()

    const started = await run(new ServiceStartTool(registry), root, {
      name: 'napper',
      description: 'start napper',
    })
    expect(started.ok).toBe(true)
    expect(started.ok && JSON.stringify(started.output)).toContain('napper')

    const listed = await run(new ServiceListTool(registry), root, {})
    expect(listed.ok && listed.modelText).toContain('[napper]')

    const restarted = await run(new ServiceRestartTool(registry), root, { id: 'napper' })
    expect(restarted.ok).toBe(true)

    const stopped = await run(new ServiceStopTool(registry), root, { id: 'napper' })
    expect(stopped.ok).toBe(true)
  })

  it('does nothing for an unknown service name on stop', async () => {
    const { registry, root } = await open()
    const stopped = await run(new ServiceStopTool(registry), root, { id: 'ghost' })
    expect(stopped.ok).toBe(false)
  })
})
