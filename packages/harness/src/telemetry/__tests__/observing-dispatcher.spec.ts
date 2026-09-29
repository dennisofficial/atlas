import { describe, expect, it } from 'bun:test'

import { TelemetryPort, type EventDraft, type RunId, type ThreadId } from '@dltech/atlas-core'

import { ToolDispatcher } from '../../tools/dispatch'
import { ObservingToolDispatcher } from '../observing-dispatcher'

class RecordingTelemetry extends TelemetryPort {
  denials: { tool: string; reasonClass: string }[] = []
  features: string[] = []

  toolDenied(args: { tool: string; reasonClass: string }): void {
    this.denials.push(args)
  }

  featureUsed(args: { feature: string }): void {
    this.features.push(args.feature)
  }

  turnCompleted(): void {}
  agentSpawned(): void {}
  agentEnded(): void {}
  exception(): void {}
  async flush(): Promise<void> {}
}

class StubDispatcher extends ToolDispatcher {
  constructor(private readonly drafts: readonly EventDraft[]) {
    super()
  }

  async dispatch(): Promise<readonly EventDraft[]> {
    return this.drafts
  }
}

const call = {
  callId: 'call_1' as never,
  name: 'write',
  input: {},
  runId: 'run_1' as RunId,
  threadId: 'brn_1' as ThreadId,
}

const dispatchArgs = {
  call,
  signal: new AbortController().signal,
  projectDirectory: '/tmp',
  events: [],
}

describe('ObservingToolDispatcher', () => {
  it('reports a denial with its class, never the raw reason', async () => {
    const telemetry = new RecordingTelemetry()
    const dispatcher = new ObservingToolDispatcher({
      inner: new StubDispatcher([
        { type: 'tool-denied', callId: 'call_1' as never, name: 'write', reason: 'Refusing to write to /Users/dennis/x.ts' },
      ]),
      telemetry,
    })

    await dispatcher.dispatch(dispatchArgs)

    expect(telemetry.denials).toEqual([{ tool: 'write', reasonClass: 'write-refusal' }])
    expect(JSON.stringify(telemetry.denials)).not.toContain('/Users/dennis')
  })

  it('counts a whitelisted feature tool on success only', async () => {
    const telemetry = new RecordingTelemetry()
    const dispatcher = new ObservingToolDispatcher({
      inner: new StubDispatcher([
        { type: 'tool-result', callId: 'call_1' as never, name: 'enter_worktree', output: 'ok' },
      ]),
      telemetry,
    })

    await dispatcher.dispatch({
      ...dispatchArgs,
      call: { ...call, name: 'enter_worktree' },
    })

    expect(telemetry.features).toEqual(['worktree-enter'])
  })

  it('does not count a feature tool that errored', async () => {
    const telemetry = new RecordingTelemetry()
    const dispatcher = new ObservingToolDispatcher({
      inner: new StubDispatcher([
        { type: 'tool-result', callId: 'call_1' as never, name: 'enter_worktree', output: undefined, error: { message: 'boom' } },
      ]),
      telemetry,
    })

    await dispatcher.dispatch({
      ...dispatchArgs,
      call: { ...call, name: 'enter_worktree' },
    })

    expect(telemetry.features).toEqual([])
  })

  it('stays silent without a telemetry port', async () => {
    const dispatcher = new ObservingToolDispatcher({
      inner: new StubDispatcher([
        { type: 'tool-denied', callId: 'call_1' as never, name: 'write', reason: 'Refusing to write to /x' },
      ]),
    })

    const drafts = await dispatcher.dispatch(dispatchArgs)
    expect(drafts).toHaveLength(1)
  })
})
