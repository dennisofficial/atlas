import { z } from 'zod'

import {
  EToolEffect,
  toCallId,
  type ThreadId,
  type EventDraft,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { scriptedModel } from '../../model/testing/scripted-model'
import { ToolDispatcher, type DispatchableCall } from '../../tools/dispatch'
import { buildHarness, type AtlasHarness } from '..'
import { createTempHome, type TempHome } from './temp-home'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

export async function discardOpened(): Promise<void> {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
}

export async function openLog(): Promise<AtlasHarness> {
  const temp = createTempHome()
  const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script: [] }) })
  opened.push({ harness, temp })
  return harness
}

const declaring = (args: { name: string; effect: EToolEffect; safe: boolean }): ToolDeclaration => ({
  name: args.name,
  description: `the ${args.name} tool`,
  effect: args.effect,
  inputSchema: z.object({}).loose(),
  ...(args.safe ? { isConcurrencySafe: () => true } : {}),
})

export const TOOLS: readonly ToolDeclaration[] = [
  declaring({ name: 'read', effect: EToolEffect.Read, safe: true }),
  declaring({ name: 'grep', effect: EToolEffect.Read, safe: true }),
  declaring({ name: 'write', effect: EToolEffect.Write, safe: false }),
  declaring({ name: 'bash', effect: EToolEffect.Destructive, safe: false }),
]

export async function branchWithCalls(args: {
  harness: AtlasHarness
  calls: readonly { callId: string; name: string }[]
}): Promise<ThreadId> {
  const thread = await args.harness.threads.create({})
  await args.harness.log.append({
    threadId: thread.id,
    runId: args.harness.ids.nextRunId(),
    drafts: [
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'working' }] },
      ...args.calls.map(
        (call, ordinal): EventDraft => ({
          type: 'tool-called',
          callId: toCallId(call.callId),
          name: call.name,
          input: {},
          ordinal,
        }),
      ),
    ],
  })
  return thread.id
}

export type Trace = { started: string[]; finished: string[]; peakInFlight: number }

class TracingDispatcher extends ToolDispatcher {
  private inFlight = 0

  constructor(
    private readonly args: {
      trace: Trace
      holdFor?: (call: DispatchableCall) => number
      draftsFor?: (call: DispatchableCall) => readonly EventDraft[]
    },
  ) {
    super()
  }

  async dispatch({ call }: { call: DispatchableCall; signal: AbortSignal }): Promise<readonly EventDraft[]> {
    const { trace } = this.args
    trace.started.push(String(call.callId))
    this.inFlight += 1
    trace.peakInFlight = Math.max(trace.peakInFlight, this.inFlight)

    await Bun.sleep(this.args.holdFor?.(call) ?? 20)

    this.inFlight -= 1
    trace.finished.push(String(call.callId))

    return (
      this.args.draftsFor?.(call) ?? [
        { type: 'tool-result', callId: call.callId, name: call.name, output: 'done', modelText: 'done' },
      ]
    )
  }
}

export const tracingDispatch = (args: {
  trace: Trace
  holdFor?: (call: DispatchableCall) => number
  draftsFor?: (call: DispatchableCall) => readonly EventDraft[]
}): ToolDispatcher => new TracingDispatcher(args)

export const freshTrace = (): Trace => ({ started: [], finished: [], peakInFlight: 0 })

export const resultOrder = async (harness: AtlasHarness, threadId: ThreadId): Promise<string[]> =>
  (await harness.log.read({ threadId }))
    .filter((event) => event.type === 'tool-result')
    .map((event) => (event.type === 'tool-result' ? String(event.callId) : ''))
