import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { CallInterruptedError } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { newKey } from '../calls/remote-calls'
import type { WorkspaceGate } from '../calls/workspace-gate'
import { interruptedMessage } from '../calls/errors'

export const pluginCallOf = (args: {
  invoke: (call: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
  }) => Promise<CallResult>
  env?: (() => Promise<Record<string, string>>) | undefined
  gate?: WorkspaceGate | undefined
}): PluginPodContext['call'] => {
  const withEnv = async (op: CallOp): Promise<CallOp> => {
    if (op.op !== 'exec' || args.env === undefined) return op
    return { ...op, env: { ...(await args.env()), ...op.env } }
  }
  const gateOf = async (
    op: CallOp,
    signal: AbortSignal | undefined,
  ): Promise<CallResult | null> => {
    if (args.gate === undefined) return null
    const outcome = await args.gate.wait(signal)
    if (outcome.state === 'prepared') return null
    if (outcome.state === 'aborted') {
      throw new CallInterruptedError(interruptedMessage(op.op))
    }
    return {
      status: ECallStatus.Failed,
      op: op.op,
      error: { code: ECallFailure.Internal, message: outcome.message },
    }
  }
  return async (op, options) => {
    const refused = await gateOf(op, options?.signal)
    if (refused !== null) return refused
    return args.invoke({
      key: newKey(),
      op: await withEnv(op),
      signal: options?.signal,
      onOutput: options?.onOutput,
    })
  }
}
