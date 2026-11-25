import { ECloudSetting } from '@dltech/atlas-plugin-sdk'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'
import { describe, expect, it } from 'bun:test'

import { rig, skillsOf, stringResource, versionsAt } from './plugin-resources-rig'

describe('the plugin-resources spans of a turn', () => {
  it('opens one root resource.refresh per round, with its trigger', async () => {
    const trace = new RecordingTracer()
    const turn = rig({ resources: [skillsOf([])], trace })

    await trace.span({ name: ESpan.TurnHooks, root: true, run: () => turn.run() })
    await turn.closed()
    await trace.span({
      name: ESpan.TurnHooks,
      root: true,
      run: async () => {
        turn.reconnect(true)
        await turn.settled()
      },
    })

    const rounds = trace.named(ESpan.ResourceRefresh)
    expect(rounds.map((span) => span.fields.trigger)).toEqual(['start', 'after-turn', 'reconnect'])
    expect(rounds.every((span) => span.parent === undefined)).toBe(true)
    expect(rounds.map((span) => span.fields.reached)).toEqual([true, true, true])
  })

  it('records a turn that waited for a missing snapshot', async () => {
    const trace = new RecordingTracer()
    const turn = rig({ resources: [skillsOf([])], trace })

    await trace.span({ name: ESpan.TurnHooks, root: true, run: () => turn.run() })

    expect(trace.named(ESpan.ResourceWait).map((span) => span.fields)).toEqual([
      { reason: 'missing', resources: 'skills', pod: 'ready' },
    ])
  })

  it('records a turn that waited for a changed cloud setting', async () => {
    const loads: string[] = []
    let value = 'one'
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => value,
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const trace = new RecordingTracer()
    const turn = rig({ resources: [skills], trace })
    await turn.run()

    value = 'two'
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })
    trace.spans.length = 0
    await trace.span({ name: ESpan.TurnHooks, root: true, run: () => turn.run() })

    expect(trace.named(ESpan.ResourceWait).map((span) => span.fields)).toEqual([
      { reason: 'cloud', resources: 'skills', pod: 'ready' },
    ])
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('records no resource.wait for a turn that waits on nothing', async () => {
    const trace = new RecordingTracer()
    const turn = rig({ resources: [skillsOf([])], trace })
    await turn.run()

    trace.spans.length = 0
    await trace.span({ name: ESpan.TurnHooks, root: true, run: () => turn.run() })

    expect(trace.named(ESpan.ResourceWait)).toEqual([])
  })
})
