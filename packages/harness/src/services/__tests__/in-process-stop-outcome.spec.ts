import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  EStopAction,
  toThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { LocalProcessPort } from '../../execution/local-process'
import { ServiceStopTool } from '../../tools/builtin/service-stop'
import { BunServiceRegistry } from '../service-registry'

const THREAD = toThreadId('thread-under-test')

const opened: { registry: BunServiceRegistry; root: string }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.registry.closeAll()
    rmSync(entry.root, { recursive: true, force: true })
  }
})

const openRegistry = (): BunServiceRegistry => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-services-'))
  const registry = new BunServiceRegistry({
    root,
    clock: { now: () => '2026-10-28T12:00:00.000Z' },
    logsDirectory: join(root, 'logs'),
    processes: new LocalProcessPort(),
  })
  opened.push({ registry, root })
  return registry
}

const stopThroughTool = (registry: BunServiceRegistry, id: string): Promise<ToolOutcome> =>
  new ServiceStopTool(registry).invoke({
    input: { id },
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: tmpdir(),
    threadId: THREAD,
  })

describe('the in-process service registry behind the awaited stop', () => {
  it('still answers a stop synchronously, with the action it took', async () => {
    const registry = openRegistry()
    await registry.start({ threadId: THREAD, command: 'sleep 30', description: 'dev server' })

    const stopped = registry.stop({ serviceId: 'svc_1', by: EKilledBy.User })

    expect(stopped).not.toBeInstanceOf(Promise)
    expect(stopped.ok && stopped.action).toBe(EStopAction.Term)
  })

  it('reports the same service_stop outcome to the model as before', async () => {
    const registry = openRegistry()
    await registry.start({ threadId: THREAD, command: 'sleep 30', description: 'dev server' })

    const outcome = await stopThroughTool(registry, 'svc_1')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.output).toMatchObject({ serviceId: 'svc_1', status: EServiceStatus.Killed })
    expect(outcome.modelText).toStartWith('Sent SIGTERM to service svc_1')
    expect(registry.list()[0]?.killedBy).toBe(EKilledBy.Model)
  })

  it('refuses an unknown id through service_stop in the registry’s own words', async () => {
    const registry = openRegistry()

    const outcome = await stopThroughTool(registry, 'svc_99')

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('svc_99')
  })
})
