import { describe, expect, it } from 'bun:test'

import { EServiceStatus, type RecordEvent } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { EServiceRunStatus, type DaemonEventFrame } from '@dltech/atlas-protocol'

import { adoptUntracked } from '../declared-adopt'
import { recordServiceFrame } from '../frames'
import { reconcileServices } from '../reconcile'
import { resumeDeclaredServices } from '../resume'
import { stateFor } from '../state'
import { invoke, rig, serviceIdOf, settle, startsOf, writeDeclared } from './support'

const ready = (serviceId: string): DaemonEventFrame => ({
  kind: 'event',
  event: { type: 'services.ready', serviceId },
})

const ended = (serviceId: string): DaemonEventFrame => ({
  kind: 'event',
  event: {
    type: 'services.ended',
    serviceId,
    info: {
      serviceId,
      command: 'listen',
      pid: 1,
      port: null,
      status: EServiceRunStatus.Exited,
      exitCode: 3,
      signal: null,
      startedAt: 1,
    },
  },
})

const record = async (args: { harness: ReturnType<typeof rig>; frame: DaemonEventFrame }) =>
  recordServiceFrame({
    ctx: args.harness.ctx,
    state: stateFor(args.harness.ctx),
    frame: args.frame,
  })

const start = async (harness: ReturnType<typeof rig>) =>
  serviceIdOf(
    await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', command: 'listen', description: 'web' },
    }),
  )

describe('sub-agent service bookkeeping', () => {
  it('records its start locally and mirrors the named service to its parent', async () => {
    const harness = rig({ subAgent: 'child-1' })
    const serviceId = await start(harness)
    const own = harness.log.find((event) => event.type === 'service-started')
    expect(own).toMatchObject({ serviceId, command: 'listen', description: 'web' })
    expect(own).not.toHaveProperty('agentId')
    expect(harness.parentLog).toEqual([
      {
        type: 'service-started',
        serviceId,
        command: 'listen',
        description: 'web',
        pid: expect.any(Number),
        cwd: '/work',
        agentId: 'child-1',
      },
    ])
  })

  it('mirrors a declared launch with its name, port and placement', async () => {
    const harness = rig({ subAgent: 'child-1' })
    writeDeclared(harness, 'services:\n  web:\n    command: listen\n    port: 3000\n')
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', name: 'web', exposePort: false },
    })
    expect(outcome.ok).toBe(true)
    expect(harness.parentLog).toMatchObject([
      {
        type: 'service-started',
        agentId: 'child-1',
        name: 'web',
        port: 3000,
        root: '/work',
      },
    ])
  })

  it('mirrors a declared service it adopts after its own record lost the start', async () => {
    const harness = rig({ subAgent: 'child-1' })
    await harness.ctx.call({
      op: 'services.start',
      serviceId: 'svc-existing',
      command: 'listen',
      cwd: '/work',
      port: 3000,
    })
    const serviceId = await adoptUntracked({
      ctx: harness.ctx,
      name: 'web',
      hash: 'hash',
      command: 'listen',
      cwd: '/work',
      port: 3000,
      place: { root: '/work' },
    })
    expect(serviceId).toBe('svc-existing')
    expect(harness.log).toMatchObject([{ type: 'service-started', name: 'web', serviceId }])
    expect(harness.parentLog).toMatchObject([
      {
        type: 'service-started',
        name: 'web',
        serviceId,
        port: 3000,
        agentId: 'child-1',
      },
    ])
  })

  it('ignores ready and ended frames for a service it did not start', async () => {
    const harness = rig({ subAgent: 'child-1' })
    await record({ harness, frame: ready('svc-other') })
    await record({ harness, frame: ended('svc-other') })
    expect(harness.log).toEqual([])
    expect(harness.notices).toEqual([])
    expect(harness.calls).toEqual([])
  })

  it('still records readiness and notifies its own ending', async () => {
    const harness = rig({ subAgent: 'child-1' })
    const serviceId = await start(harness)
    await record({ harness, frame: ready(serviceId) })
    await record({ harness, frame: ended(serviceId) })
    expect(harness.log.at(-1)).toMatchObject({ type: 'service-ready', serviceId })
    expect(harness.notices).toMatchObject([
      {
        event: { type: 'service-ended', serviceId, status: EServiceStatus.Exited, exitCode: 3 },
      },
    ])
    expect(harness.notices[0]?.event).not.toHaveProperty('agentId')
  })

  it('waits for its in-flight start before recording a ready frame', async () => {
    const harness = rig({ subAgent: 'child-1' })
    const state = stateFor(harness.ctx)
    let finish: () => void = () => undefined
    state.starting.set(
      'svc-starting',
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const recording = record({ harness, frame: ready('svc-starting') })
    expect(harness.log).toEqual([])
    await harness.ctx.append([
      { type: 'service-started', serviceId: 'svc-starting', command: 'listen' },
    ])
    finish()
    await recording
    expect(harness.log.at(-1)).toMatchObject({ type: 'service-ready', serviceId: 'svc-starting' })
  })

  it('records a mirrored ending once without notifying the main thread', async () => {
    const harness = rig()
    await harness.ctx.append([
      {
        type: 'service-started',
        serviceId: 'svc-child',
        command: 'listen',
        description: 'web',
        agentId: 'child-1',
      },
    ])
    await record({ harness, frame: ready('svc-child') })
    await record({ harness, frame: ended('svc-child') })
    await record({ harness, frame: ended('svc-child') })
    expect(harness.notices).toEqual([])
    expect(harness.log.filter((event) => event.type === 'service-ended')).toMatchObject([
      {
        serviceId: 'svc-child',
        agentId: 'child-1',
        description: 'web',
        exitCode: 3,
      },
    ])
    expect(harness.log.filter((event) => event.type === 'service-ended')).toHaveLength(1)
  })

  it('reconciles a lost mirrored service with append instead of notify', async () => {
    const harness = rig()
    await harness.ctx.append([
      {
        type: 'service-started',
        serviceId: 'svc-child',
        command: 'listen',
        agentId: 'child-1',
      },
    ])
    await reconcileServices({ ctx: harness.ctx, state: stateFor(harness.ctx) })
    expect(harness.notices).toEqual([])
    expect(harness.log.at(-1)).toMatchObject({
      type: 'service-ended',
      serviceId: 'svc-child',
      agentId: 'child-1',
    })
  })

  it('never restarts a mirrored declared service in the main thread', async () => {
    const harness = rig()
    writeDeclared(harness, 'services:\n  web:\n    command: listen\n')
    await harness.ctx.append([
      {
        type: 'service-started',
        serviceId: 'svc-child',
        command: 'listen',
        name: 'web',
        root: '/work',
        declarationHash: 'hash',
        agentId: 'child-1',
      },
    ])
    await resumeDeclaredServices({ ctx: harness.ctx, state: stateFor(harness.ctx) })
    expect(harness.notices).toEqual([])
    expect(startsOf(harness.calls)).toEqual([])
    expect(harness.log.at(-1)).toMatchObject({ type: 'service-ended', agentId: 'child-1' })
  })

  it('keeps the main thread quiet when a sub-agent service ends before its start is mirrored', async () => {
    const harness = rig({ subAgent: 'child-1' })
    const mainNotices: unknown[] = []
    const main: PluginPodContext = {
      ...harness.ctx,
      subAgent: undefined,
      events: () => harness.parentLog as unknown as RecordEvent[],
      append: async (drafts) => {
        harness.parentLog.push(...drafts)
      },
      notify: async (event) => {
        mainNotices.push(event)
      },
    }
    const mainState = stateFor(main)
    harness.ctx.onDaemonEvent((frame) => {
      void recordServiceFrame({ ctx: main, state: mainState, frame })
    })
    const serviceId = serviceIdOf(
      await invoke({
        ctx: harness.ctx,
        name: 'service',
        input: { action: 'start', command: 'echo done', description: 'web' },
      }),
    )
    await settle()
    expect(mainNotices).toEqual([])
    expect(harness.parentLog).toMatchObject([
      { type: 'service-started', serviceId, agentId: 'child-1' },
      { type: 'service-ended', serviceId, agentId: 'child-1' },
    ])
  })
})
