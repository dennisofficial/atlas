import { ECloudSetting, readResource, type PodResource } from '@dltech/atlas-plugin-sdk'
import { EResourceWait, ESpan } from '@dltech/atlas-observability'
import { RecordingTracer, type RecordedSpan } from '@dltech/atlas-observability/testing'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { pluginResourcesHook } from '../plugin-resources'
import {
  DIRECTORY,
  agentsRootOf,
  rig,
  skillsOf,
  snapshotEventOf,
  stringResource,
  THREAD,
  versionsAt,
} from './plugin-resources-rig'

const HOLD_MS = 120
const TIMER_SLACK_MS = 20

const sleep = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

const durationOf = (span: RecordedSpan | undefined): number =>
  span === undefined || span.endedAtMs === undefined ? -1 : span.endedAtMs - span.startedAtMs

type Gate = { readonly promise: Promise<string>; open(value: string): void }

const gateOf = (): Gate => {
  let open: (value: string) => void = () => undefined
  const promise = new Promise<string>((resolve) => {
    open = resolve
  })
  return { promise, open: (value) => open(value) }
}

const gatedToolsOf = (args: { gate: Gate; attempts: { count: number } }): PodResource<string> => ({
  name: 'mcp-tools',
  schema: z.string(),
  watch: () => ({ roots: [agentsRootOf(DIRECTORY)] }),
  background: true,
  cloud: [ECloudSetting.Skills],
  load: async () => {
    args.attempts.count += 1
    if (args.attempts.count === 1) return 'tools v1'
    return await args.gate.promise
  },
})

const waitSpanOf = (args: {
  trace: RecordingTracer
  waitFor: EResourceWait
}): RecordedSpan | undefined =>
  args.trace.named(ESpan.ResourceWait).find((span) => span.fields.waitFor === args.waitFor)

describe('the turn times what it waits for on plugin resources', () => {
  it('covers an initial refresh that started before the turn', async () => {
    const trace = new RecordingTracer()
    const turn = rig({
      resources: [skillsOf([])],
      trace,
      beforeCall: async (op) => {
        if (op.op === 'watch.status') await sleep(HOLD_MS)
      },
    })
    turn.start()

    const hook = pluginResourcesHook({ sync: turn.sync })
    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => hook.run({ threadId: THREAD, projectDirectory: DIRECTORY }),
    })

    const wait = waitSpanOf({ trace, waitFor: EResourceWait.InitialRefresh })
    expect(wait?.parent?.name).toBe(ESpan.Turn)
    expect(durationOf(wait)).toBeGreaterThanOrEqual(HOLD_MS - TIMER_SLACK_MS)
  }, 10_000)

  it('records no wait for a background load the turn does not block on', async () => {
    const trace = new RecordingTracer()
    const gate = gateOf()
    const attempts = { count: 0 }
    const turn = rig({ resources: [skillsOf([]), gatedToolsOf({ gate, attempts })], trace })
    turn.start()
    await turn.sync.settled()
    await sleep(10)

    turn.daemon.setVersions(versionsAt('v2'))
    turn.closed()
    await turn.sync.settled()
    expect(attempts.count).toBe(2)

    const hook = pluginResourcesHook({ sync: turn.sync })
    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => hook.run({ threadId: THREAD, projectDirectory: DIRECTORY }),
    })
    await sleep(20)
    gate.open('tools v2')
    await turn.sync.settled()
    await sleep(20)

    expect(trace.named(ESpan.ResourceWait)).toEqual([])
  }, 10_000)

  it('records no wait for a cloud reload it starts in the background', async () => {
    const trace = new RecordingTracer()
    const gate = gateOf()
    const loads: string[] = []
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => 'two',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({
      resources: [skills],
      trace,
      podReady: false,
      beforeCall: async (op) => {
        if (op.op === 'watch.status') await gate.promise
      },
    })
    turn.events.push(
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0:v1:${DIRECTORY}`,
        value: 'one',
      }),
    )
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })

    turn.sync.start()
    const hook = pluginResourcesHook({ sync: turn.sync })
    const started = Date.now()
    await trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => hook.run({ threadId: THREAD, projectDirectory: DIRECTORY }),
    })
    expect(Date.now() - started).toBeLessThan(HOLD_MS)

    turn.setPodReady(true)
    gate.open('')
    await turn.settled()
    await sleep(20)

    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
    expect(trace.named(ESpan.ResourceWait)).toEqual([])
  }, 10_000)

  it('times the changed resource load the hook waits for', async () => {
    const trace = new RecordingTracer()
    const gate = gateOf()
    const loads: string[] = []
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => 'two',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({
      resources: [skills],
      trace,
      beforeAppend: async () => {
        await gate.promise
      },
    })
    turn.events.push(
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-1:0:v1:${DIRECTORY}`,
        value: 'one',
      }),
    )
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })

    const hook = pluginResourcesHook({ sync: turn.sync })
    const running = trace.span({
      name: ESpan.Turn,
      root: true,
      run: () => hook.run({ threadId: THREAD, projectDirectory: DIRECTORY }),
    })
    await sleep(HOLD_MS)
    gate.open('')
    await running
    await turn.settled()

    const waits = trace
      .named(ESpan.ResourceWait)
      .filter((span) => span.fields.waitFor === EResourceWait.ChangedResource)
    expect(waits.map((span) => span.fields.resource)).toEqual(['skills'])
    expect(waits.every((span) => span.parent?.name === ESpan.Turn)).toBe(true)
    expect(durationOf(waits[0])).toBeGreaterThanOrEqual(HOLD_MS - TIMER_SLACK_MS)
    expect(loads).toEqual(['skills'])
  }, 10_000)

  it('opens a load span for a background resource', async () => {
    const trace = new RecordingTracer()
    const gate = gateOf()
    const turn = rig({
      resources: [skillsOf([]), gatedToolsOf({ gate, attempts: { count: 1 } })],
      trace,
    })

    await trace.span({ name: ESpan.Turn, root: true, run: () => turn.run() })
    gate.open('tools')
    await sleep(20)

    const loads = trace.named(ESpan.ResourceLoad).map((span) => span.fields)
    expect(loads).toEqual([
      { resource: 'mcp-tools', phase: 'missing' },
      { resource: 'skills', phase: 'missing' },
    ])
    expect(trace.named(ESpan.ResourceLoad).every((span) => span.parent?.name === ESpan.Turn)).toBe(
      true,
    )
  }, 10_000)
})
