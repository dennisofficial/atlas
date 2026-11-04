import {
  EFinishReason,
  toCallId,
  type Assembled,
  type ChunkFilter,
  type ModelPort,
  type ModelStepResult,
  type ProviderIdentity,
  type ToolDeclaration,
} from '@dltech/atlas-core'

export type ScriptedModelStep =
  | {
      text?: string
      calls?: readonly { callId: string; name: string; input: unknown }[]
      streamMs?: number
      gateFile?: string
    }
  | { throws: unknown }

export type ModelRequest = { assembled: Assembled; tools: readonly ToolDeclaration[] }

const abortIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw signal.reason as unknown
}

const waitUnlessAborted = (args: { ms: number; signal: AbortSignal }): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (args.signal.aborted) {
      reject(args.signal.reason as unknown)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(args.signal.reason as unknown)
    }
    const timer = setTimeout(() => {
      args.signal.removeEventListener('abort', onAbort)
      resolve()
    }, args.ms)
    args.signal.addEventListener('abort', onAbort, { once: true })
  })

const waitForGateFile = async (args: {
  path: string
  signal: AbortSignal
  fileExists: (path: string) => boolean
}): Promise<void> => {
  while (!args.fileExists(args.path)) {
    await waitUnlessAborted({ ms: 25, signal: args.signal })
  }
}

const STREAM_PIECES = 32

export class ScriptedModel implements ModelPort {
  readonly requests: ModelRequest[] = []
  private cursor = 0

  constructor(
    private readonly script: readonly ScriptedModelStep[],
    readonly identity: ProviderIdentity = { id: 'scripted', modelId: 'scripted-1' },
    private readonly fileExists?: (path: string) => boolean,
  ) {}

  step: ModelPort['step'] = async ({ assembled, tools, signal, onChunk }) => {
    this.requests.push({ assembled, tools })
    const scripted = this.script[this.cursor]
    this.cursor += 1
    if (scripted === undefined) throw new Error('scripted model ran out of steps')
    if ('throws' in scripted) throw scripted.throws
    abortIfAborted(signal)
    if (scripted.gateFile !== undefined) {
      if (this.fileExists === undefined) {
        throw new Error('gateFile steps need a fileExists function on the ScriptedModel')
      }
      await waitForGateFile({ path: scripted.gateFile, signal, fileExists: this.fileExists })
    }
    const text = scripted.text
    const streamed =
      text !== undefined && scripted.streamMs !== undefined
        ? await this.streamText({ text, streamMs: scripted.streamMs, signal, onChunk })
        : undefined
    const finalText = streamed === undefined ? text : streamed.text
    const calls = streamed?.aborted === true ? [] : (scripted.calls ?? [])
    const result: ModelStepResult = {
      parts: finalText === undefined ? [] : [{ type: 'text', text: finalText }],
      toolCalls: calls.map((call) => ({ ...call, callId: toCallId(call.callId) })),
      finishReason: calls.length > 0 ? EFinishReason.ToolCalls : EFinishReason.Stop,
    }
    return result
  }

  private async streamText(args: {
    text: string
    streamMs: number
    signal: AbortSignal
    onChunk: ChunkFilter | undefined
  }): Promise<{ text: string; aborted: boolean }> {
    const pieces = Math.max(1, Math.min(STREAM_PIECES, args.text.length))
    const intervalMs = args.streamMs / pieces
    const boundary = (index: number): number => Math.round((index * args.text.length) / pieces)
    const id = `text-${this.cursor}`
    args.onChunk?.({ type: 'text-start', id })
    let sent = ''
    try {
      for (let index = 0; index < pieces; index += 1) {
        await waitUnlessAborted({ ms: intervalMs, signal: args.signal })
        const piece = args.text.slice(boundary(index), boundary(index + 1))
        sent += piece
        args.onChunk?.({ type: 'text-delta', id, text: piece })
      }
    } catch (error) {
      if (!args.signal.aborted) throw error
      return { text: sent, aborted: true }
    }
    args.onChunk?.({ type: 'text-end', id })
    return { text: args.text, aborted: false }
  }
}
