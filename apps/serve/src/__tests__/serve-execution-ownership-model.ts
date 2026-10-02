import { toCallId, EFinishReason, type ModelPort, type ModelStepResult } from '@dltech/atlas-core'

export type OwnershipStep = {
  text?: string | undefined
  hold?: Promise<void> | undefined
  entered?: (() => void) | undefined
  calls?: readonly { callId: string; name: string; input: unknown }[] | undefined
}

export function scriptedPort(args: {
  steps: readonly OwnershipStep[]
  modelId: string
  beforeStep?: ((index: number) => Promise<void>) | undefined
}): ModelPort {
  let used = 0
  return {
    identity: { id: 'ownership', modelId: args.modelId },
    step: async ({ signal }): Promise<ModelStepResult> => {
      signal?.throwIfAborted()
      const candidate = args.steps[Math.min(used, Math.max(args.steps.length - 1, 0))]
      candidate?.entered?.()
      const preparation = candidate?.hold ?? args.beforeStep?.(used)
      if (preparation !== undefined) {
        let onAbort = (): void => undefined
        try {
          await Promise.race([preparation, new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(new Error('test model aborted'))
            signal?.addEventListener('abort', onAbort, { once: true })
          })])
        } finally {
          signal?.removeEventListener('abort', onAbort)
        }
      }
      signal?.throwIfAborted()
      const fallback: OwnershipStep = { text: 'done' }
      const step = args.steps[Math.min(used, Math.max(args.steps.length - 1, 0))] ?? fallback
      used += 1
      return {
        parts: step.text === undefined ? [] : [{ type: 'text', text: step.text }],
        toolCalls: (step.calls ?? []).map((call) => ({
          callId: toCallId(call.callId),
          name: call.name,
          input: call.input,
        })),
        finishReason: (step.calls?.length ?? 0) > 0 ? EFinishReason.ToolCalls : EFinishReason.Stop,
      }
    },
  }
}
