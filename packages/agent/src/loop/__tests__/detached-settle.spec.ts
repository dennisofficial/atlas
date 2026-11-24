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
import { PauseSignal } from '../pause-signal'
import { ETurnStatus } from '../turn-outcome'

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

class InterruptedSettleTool extends FakeTool {
  started = false
  private release: (() => void) | undefined

  releaseNow(): void {
    this.release?.()
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    return {
      ok: false,
      reason: 'service was interrupted by a process restart before its result was recorded',
    }
  }
}

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('a call the drain detaches', () => {
  it('marks a host-side call detached so the next host re-dispatches rather than settling a crash', async () => {
    const tool = new GatedTool()
    const rig = rigOf({
      script: [{ calls: [{ callId: 'call-1', name: 'slow', input: {} }] }, { text: 'done' }],
      tools: [tool],
      overrides: { detachTool: () => false },
    })
    await rig.record.append({
      threadId: THREAD,
      runId: RUN,
      drafts: [{ type: 'user-said', text: 'run it' }],
    })

    const abort = new AbortController()
    const turn = rig.runner.runTurn({ threadId: THREAD, signal: abort.signal })
    await until(() => tool.started)
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

  it('leaves a daemon call on its plain dispatch so the next host reattaches it', async () => {
    const tool = new GatedTool()
    let draining = false
    const rig = rigOf({
      script: [{ calls: [{ callId: 'call-1', name: 'slow', input: {} }] }, { text: 'done' }],
      tools: [tool],
      overrides: { detachTool: (name) => draining && name === 'slow' },
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
    ).toEqual([undefined])
    expect(events.some((event) => event.type === 'tool-result')).toBe(false)

    const state = loopStateOf({ events })
    expect(crashedCallsOf(state).map((call) => call.callId)).toEqual([CALL])
  })

  it("drops a pod call's synthetic result when the drain pauses the turn", async () => {
    const tool = new InterruptedSettleTool('service', 'unused')
    let draining = false
    const rig = rigOf({
      script: [{ calls: [{ callId: 'call-1', name: 'service', input: {} }] }, { text: 'done' }],
      tools: [tool],
      overrides: { detachTool: (name) => draining && name === 'service' },
    })
    await rig.record.append({
      threadId: THREAD,
      runId: RUN,
      drafts: [{ type: 'user-said', text: 'start it' }],
    })

    const pause = new PauseSignal()
    const abort = new AbortController()
    const turn = rig.runner.runTurn({ threadId: THREAD, signal: abort.signal, pause })
    await until(() => tool.started)
    draining = true
    pause.pause()
    tool.releaseNow()
    const outcome = await turn

    expect(outcome.status).toBe(ETurnStatus.HandoffPaused)
    const events = rig.record.eventsOf(THREAD)
    expect(events.some((event) => event.type === 'tool-result')).toBe(false)
    const state = loopStateOf({ events })
    expect(crashedCallsOf(state).map((call) => call.callId)).toEqual([CALL])
    expect(settleablePendingOf(state).map((call) => call.callId)).toEqual([CALL])
  })
})
