import { describe, expect, it, mock } from 'bun:test'

import { defaultPipeline, toCallId, toRunId } from '@dltech/atlas-core'

import { ETurnStatus } from '../loop/turn-outcome'
import { FakeTool } from '../testing'
import { THREAD, instantRetry, rigOf, sayDraft } from './exit-fixture'

const SPENT_AFTER_TWO = { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 }

describe('the agent runner without a filesystem, pod or lease', () => {
  it('runs a tool round trip: dispatch is recorded before invocation, the result feeds the next step', async () => {
    const seenWhenInvoked: string[] = []
    let rig: ReturnType<typeof rigOf> | undefined
    const read = new FakeTool('read_file', 'file contents', () => {
      seenWhenInvoked.push(...(rig?.record.eventsOf(THREAD).map((event) => event.type) ?? []))
    })
    rig = rigOf({
      tools: [read],
      script: [{ calls: [{ callId: 'call-a', name: 'read_file', input: {} }] }, { text: 'done' }],
    })

    const outcome = await rig.runner.say({ threadId: THREAD, text: 'look at the file' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(seenWhenInvoked).toContain('tool-dispatched')
    expect(read.invocations).toHaveLength(1)
    const types = rig.record.eventsOf(THREAD).map((event) => event.type)
    expect(types.indexOf('tool-dispatched')).toBeLessThan(types.indexOf('tool-result'))
    const result = rig.record.eventsOf(THREAD).find((event) => event.type === 'tool-result')
    expect(result).toMatchObject({ callId: toCallId('call-a'), modelText: 'file contents' })
    expect(rig.model.requests).toHaveLength(2)
    expect(JSON.stringify(rig.model.requests[1]?.assembled.messages)).toContain('file contents')
  })

  it('drains input queued during a retry backoff into the retried request', async () => {
    let enqueue: () => void = () => {}
    const rig = rigOf({
      script: [{ throws: new Error('connection reset') }, { text: 'seen it' }],
      overrides: {
        retry: {
          jitter: () => 0,
          sleep: async () => {
            enqueue()
          },
        },
      },
    })
    enqueue = () => rig.intake.enqueue({ drafts: [sayDraft('fresh during backoff')] })

    const outcome = await rig.runner.say({ threadId: THREAD, text: 'first' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(rig.model.requests).toHaveLength(2)
    expect(JSON.stringify(rig.model.requests[0]?.assembled.messages)).not.toContain('fresh during')
    expect(JSON.stringify(rig.model.requests[1]?.assembled.messages)).toContain(
      'fresh during backoff',
    )
  })

  it('releases the intake batch, without acknowledging it, when the record refuses the append', async () => {
    const rig = rigOf({ script: [{ text: 'unused' }] })
    await rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-seed'),
      drafts: [sayDraft('opening')],
    })
    const queued = sayDraft('queued input')
    rig.intake.enqueue({ drafts: [queued] })
    rig.record.failNextAppend(new Error('disk full'))

    await rig.runner.runTurn({ threadId: THREAD }).catch(() => undefined)

    expect(rig.intake.released).toEqual([[queued]])
    expect(rig.intake.acknowledged).toEqual([])
    expect(rig.model.requests).toHaveLength(0)
  })

  it('shows each runner built from one recipe only its own tools and prompt', async () => {
    const recipe = (args: { withTool: boolean; prompt: string }) =>
      rigOf({
        script: [{ text: 'ok' }],
        tools: args.withTool ? [new FakeTool('extra_tool', 'x')] : [],
        assembly: defaultPipeline({
          prompt: () => ({ blocks: [{ text: args.prompt }], parts: [], skipped: [] }),
          launchDirectory: '/w',
        }),
      })
    const full = recipe({ withTool: true, prompt: 'GROUP-A prompt' })
    const bare = recipe({ withTool: false, prompt: 'base prompt' })

    await full.runner.say({ threadId: THREAD, text: 'hi' })
    await bare.runner.say({ threadId: THREAD, text: 'hi' })

    const seen = (rig: typeof full) => ({
      tools: rig.model.requests[0]?.tools.map((tool) => tool.name),
      system: rig.model.requests[0]?.assembled.system.map((block) => block.text),
    })
    expect(seen(full)).toEqual({ tools: ['extra_tool'], system: ['GROUP-A prompt'] })
    expect(seen(bare)).toEqual({ tools: [], system: ['base prompt'] })
  })

  it('consults failover once when retries are spent, then succeeds on the switched model', async () => {
    const failover = mock(() => true)
    const rig = rigOf({
      script: [{ throws: new Error('reset') }, { throws: new Error('reset') }, { text: 'back' }],
      overrides: {
        retry: { ...instantRetry, policy: SPENT_AFTER_TWO, failover },
      },
    })

    const outcome = await rig.runner.say({ threadId: THREAD, text: 'go' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(failover).toHaveBeenCalledTimes(1)
    expect(rig.model.requests).toHaveLength(3)
  })

  it('fails the turn when retries are spent and no failover is configured', async () => {
    const rig = rigOf({
      script: [{ throws: new Error('reset') }, { throws: new Error('reset') }, { text: 'never' }],
      overrides: { retry: { ...instantRetry, policy: SPENT_AFTER_TWO } },
    })

    await expect(rig.runner.say({ threadId: THREAD, text: 'go' })).rejects.toThrow('reset')

    expect(rig.model.requests).toHaveLength(2)
    expect(rig.record.eventsOf(THREAD).map((event) => event.type)).toContain('run-failed')
  })

  it('assembles only from the context port while ownEvents still drives decisions', async () => {
    const lookup = new FakeTool('lookup', 'found')
    const rig = rigOf({
      tools: [lookup],
      script: [{ text: 'fine' }],
      window: (events) =>
        events.filter((event) => !JSON.stringify(event).includes('COVERED-HISTORY')),
    })
    await rig.record.append({
      threadId: THREAD,
      runId: toRunId('run-seed'),
      drafts: [
        sayDraft('COVERED-HISTORY'),
        sayDraft('kept in window'),
        { type: 'tool-called', callId: toCallId('call-p'), name: 'lookup', input: {}, ordinal: 0 },
      ],
    })

    const outcome = await rig.runner.runTurn({ threadId: THREAD })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(lookup.invocations).toHaveLength(1)
    expect(JSON.stringify(rig.model.requests[0]?.assembled.messages)).not.toContain(
      'COVERED-HISTORY',
    )
  })
})
