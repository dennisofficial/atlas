import { describe, expect, it } from 'bun:test'

import { saidBody, toRunId, type Event } from '@dltech/atlas-core'

import { rigOf, THREAD } from '../../__tests__/exit-fixture'
import { FakeTool } from '../../testing'
import type { AgentOutputEvent } from '../agent-output'

const stepsOf = (events: readonly Event[]) =>
  events.flatMap((event) => (event.type === 'assistant-said' ? [event.step] : []))

describe('the step a recorded reply carries', () => {
  it('matches the step the streamer keyed, for step 0 and step 1 of a tool run', async () => {
    const keyed: number[] = []
    const output = {
      emit: (event: AgentOutputEvent) => {
        if (event.type === 'step-start') keyed.push(event.key.step)
      },
    }
    const tool = new FakeTool('read', 'contents')
    const rig = rigOf({
      script: [
        { text: 'looking', calls: [{ callId: 'c1', name: 'read', input: {} }] },
        { text: 'done' },
      ],
      tools: [tool],
      overrides: { output },
    })
    await rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-seed'),
      drafts: [saidBody({ text: 'go' })],
    })
    await rig.runner.runTurn({ threadId: THREAD })

    expect(keyed).toEqual([0, 1])
    expect(stepsOf(rig.record.eventsOf(THREAD))).toEqual([0, 1])
  })
})
