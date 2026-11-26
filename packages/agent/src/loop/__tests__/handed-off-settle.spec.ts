import { describe, expect, it } from 'bun:test'

import {
  crashedCallsOf,
  loopStateOf,
  toCallId,
  toRunId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { FakeTool } from '../../testing'
import { rigOf, THREAD } from '../../__tests__/exit-fixture'
import { PauseSignal } from '../pause-signal'

const CALL = toCallId('call-1')
const RUN = toRunId('run-1')

class HandedOffTool extends FakeTool {
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
    return { ok: true, output: 'exit code 124', modelText: 'exit code 124' }
  }
}

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const drainOneCall = async (args: { name: string; detachOnHandoff: boolean }) => {
  const tool = new HandedOffTool(args.name, 'unused')
  const pause = new PauseSignal()
  const rig = rigOf({
    script: [{ calls: [{ callId: 'call-1', name: args.name, input: {} }] }, { text: 'done' }],
    tools: [tool],
    overrides: { detachTool: (name) => args.detachOnHandoff && name === args.name },
  })
  await rig.record.append({
    threadId: THREAD,
    runId: RUN,
    drafts: [{ type: 'user-said', text: 'run it' }],
  })

  const turn = rig.runner.runTurn({ threadId: THREAD, pause })
  await until(() => tool.started)
  pause.pause()
  tool.releaseNow()
  await turn

  const events = rig.record.eventsOf(THREAD)
  return {
    results: events.filter((event) => event.type === 'tool-result'),
    dispatches: events.filter((event) => event.type === 'tool-dispatched'),
    state: loopStateOf({ events }),
  }
}

describe('the synthetic handed-off result of a docking call', () => {
  for (const name of ['bash', 'read_file', 'write_file']) {
    it(`is never recorded for the daemon tool ${name}`, async () => {
      const drained = await drainOneCall({ name, detachOnHandoff: true })

      expect(drained.results).toEqual([])
      expect(drained.dispatches).toHaveLength(1)
      expect(
        drained.dispatches.map((event) =>
          event.type === 'tool-dispatched' ? event.detached : undefined,
        ),
      ).toEqual([undefined])
      expect(crashedCallsOf(drained.state).map((call) => call.callId)).toEqual([CALL])
    })
  }

  it('is recorded for a tool the drain keeps as host work', async () => {
    const kept = await drainOneCall({ name: 'slow', detachOnHandoff: false })

    expect(kept.results).toHaveLength(1)
    expect(crashedCallsOf(kept.state)).toEqual([])
  })
})
