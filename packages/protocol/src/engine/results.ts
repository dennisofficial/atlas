import {
  ECallFailure,
  ECallStatus,
  callFailureOf,
  okCallResultSchema,
  type CallOp,
  type CallResult,
  type OpName,
} from '../ops'
import type { CallContext, RegisteredOp } from './group'

export const failedResult = (args: {
  op: OpName
  code: ECallFailure
  message: string
}): CallResult => ({
  status: ECallStatus.Failed,
  op: args.op,
  error: { code: args.code, message: args.message },
})

export const invokeOp = async (args: {
  handler: RegisteredOp
  op: CallOp
  ctx: CallContext
}): Promise<CallResult> => {
  const name = args.op.op
  try {
    const value = await args.handler.run({ op: args.op, ctx: args.ctx })
    const parsed = okCallResultSchema.safeParse({ status: ECallStatus.Ok, op: name, value })
    if (parsed.success) return parsed.data
    return failedResult({
      op: name,
      code: ECallFailure.Internal,
      message: `${name} returned an invalid value: ${parsed.error.message}`,
    })
  } catch (error) {
    const failure = callFailureOf(error)
    return failedResult({ op: name, code: failure.code, message: failure.message })
  }
}
