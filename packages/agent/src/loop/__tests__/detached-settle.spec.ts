import { describe, expect, it } from 'bun:test'

import {
  crashedCallsOf,
  loopStateOf,
  settleablePendingOf,
  toCallId,
  toRunId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { FakeTool } from '../../testing'
import { rigOf, THREAD } from '../../__tests__/exit-fixture'

const CALL = toCallId('call-1')
const RUN = toRunId('run-1')

class GatedTool extends FakeTool {
  started = false
  private release: (() => void) | undefined

  constructor() {
    super('slow', 'done')
  }

  releaseNow(): void {
    this.release?.()
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    return { ok: true, output: 'done', modelText: 'done' }
  }
}

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('a host-side call the drain detaches', () => {
  it('records a detached marker so the next host re-dispatches rather than settling a crash', async () => {
    const tool = new GatedTool()
    let draining = false
    const rig = rigOf({
      script: [{ calls: [{ callId: 'call-1', name: 'slow', input: {} }] }, { text: 'done' }],
      tools: [tool],
      overrides: { detachTool: () => draining },
    })
    await rig.record.append({
      threadId: THREAD,
      runId: RUN,
      drafts: [{ type: 'user-said', text: 'run it' }],
    })

    const abort = new AbortController()
    const turn = rig.runner.runTurn({ threadId: THREAD, signal: abort.signal })
    await until(() => tool.started)
    draining = true
    abort.abort('handoff')
    tool.releaseNow()
    await turn

    const events = rig.record.eventsOf(THREAD)
    const dispatches = events.filter((event) => event.type === 'tool-dispatched')
    expect(
      dispatches.map((event) => (event.type === 'tool-dispatched' ? event.detached : undefined)),
    ).toEqual([undefined, true])
    expect(events.some((event) => event.type === 'tool-result')).toBe(false)

    const state = loopStateOf({ events })
    expect(crashedCallsOf(state)).toEqual([])
    expect(settleablePendingOf(state).map((call) => call.callId)).toEqual([CALL])
  })
})
