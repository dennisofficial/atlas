import {
  EFinishReason,
  toCallId,
  type Assembled,
  type ModelPort,
  type ModelStepResult,
  type ProviderIdentity,
  type ToolDeclaration,
} from '@dltech/atlas-core'

export type ScriptedModelStep =
  | { text?: string; calls?: readonly { callId: string; name: string; input: unknown }[] }
  | { throws: unknown }

export type ModelRequest = { assembled: Assembled; tools: readonly ToolDeclaration[] }

export class ScriptedModel implements ModelPort {
  readonly requests: ModelRequest[] = []
  private cursor = 0

  constructor(
    private readonly script: readonly ScriptedModelStep[],
    readonly identity: ProviderIdentity = { id: 'scripted', modelId: 'scripted-1' },
  ) {}

  step: ModelPort['step'] = async ({ assembled, tools }) => {
    this.requests.push({ assembled, tools })
    const scripted = this.script[this.cursor]
    this.cursor += 1
    if (scripted === undefined) throw new Error('scripted model ran out of steps')
    if ('throws' in scripted) throw scripted.throws
    const calls = scripted.calls ?? []
    const result: ModelStepResult = {
      parts: scripted.text === undefined ? [] : [{ type: 'text', text: scripted.text }],
      toolCalls: calls.map((call) => ({ ...call, callId: toCallId(call.callId) })),
      finishReason: calls.length > 0 ? EFinishReason.ToolCalls : EFinishReason.Stop,
    }
    return result
  }
}
