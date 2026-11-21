import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import { newKey } from '../calls/remote-calls'

export const pluginCallOf = (args: {
  invoke: (call: {
    key: string
    op: CallOp
    signal?: AbortSignal | undefined
    onOutput?: ((bytes: Uint8Array) => void) | undefined
  }) => Promise<CallResult>
  env?: (() => Promise<Record<string, string>>) | undefined
}): PluginPodContext['call'] => {
  const withEnv = async (op: CallOp): Promise<CallOp> => {
    if (op.op !== 'exec' || args.env === undefined) return op
    return { ...op, env: { ...(await args.env()), ...op.env } }
  }
  return async (op, options) =>
    args.invoke({
      key: newKey(),
      op: await withEnv(op),
      signal: options?.signal,
      onOutput: options?.onOutput,
    })
}
