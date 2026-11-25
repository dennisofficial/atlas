import { ECloudSetting } from '@dltech/atlas-plugin-sdk'
import { EResourceWait, ESpan } from '@dltech/atlas-observability'
import { RecordingTracer, type RecordedSpan } from '@dltech/atlas-observability/testing'
import { describe, expect, it } from 'bun:test'

import { rig, skillsOf, stringResource, versionsAt } from './plugin-resources-rig'

const waitSpansOf = (trace: RecordingTracer, waitFor: EResourceWait): RecordedSpan[] =>
  trace.named(ESpan.ResourceWait).filter((span) => span.fields.waitFor === waitFor)

describe('the wait span of a turn that waits on a changed cloud setting', () => {
  it('names the changed resource', async () => {
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
    await trace.span({ name: ESpan.Turn, root: true, run: () => turn.run() })

    const waits = waitSpansOf(trace, EResourceWait.ChangedResource)
    expect(waits.map((span) => span.fields.resource)).toEqual(['skills'])
    expect(waits.every((span) => span.parent?.name === ESpan.Turn)).toBe(true)
    expect(loads).toEqual(['skills', 'skills'])
  })

  it('records no changed-resource wait for a turn that waits on nothing', async () => {
    const trace = new RecordingTracer()
    const turn = rig({ resources: [skillsOf([])], trace })
    await turn.run()

    trace.spans.length = 0
    await trace.span({ name: ESpan.Turn, root: true, run: () => turn.run() })

    expect(waitSpansOf(trace, EResourceWait.ChangedResource)).toEqual([])
  })
})
