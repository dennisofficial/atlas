import {
  CallFailureError,
  ECallStatus,
  type CallOp,
  type CallResult,
  type OpName,
  type OpValue,
} from '@dltech/atlas-protocol'
import { ECallFailure } from '@dltech/atlas-protocol'

import { markInterrupted, nextKey, scopeDispatchedBootId } from '../call-scope'
import type { RemoteCalls } from '../remote-calls'

const FAILURE_ERRNOS: Readonly<Partial<Record<ECallFailure, string>>> = {
  [ECallFailure.NotFound]: 'ENOENT',
  [ECallFailure.PermissionDenied]: 'EACCES',
  [ECallFailure.AlreadyExists]: 'EEXIST',
  [ECallFailure.NotADirectory]: 'ENOTDIR',
  [ECallFailure.IsADirectory]: 'EISDIR',
  [ECallFailure.NotEmpty]: 'ENOTEMPTY',
  [ECallFailure.InvalidInput]: 'EINVAL',
}

export const throwFailure = (
  result: Extract<CallResult, { status: ECallStatus.Failed }>,
): never => {
  if (result.error.code === ECallFailure.Interrupted) markInterrupted()
  const errno = FAILURE_ERRNOS[result.error.code]
  if (errno !== undefined) {
    throw Object.assign(new Error(`${errno}: ${result.error.message}`), { code: errno })
  }
  throw new CallFailureError(result.error)
}

export const valueFrom = <K extends OpName>(args: { result: CallResult; op: K }): OpValue<K> => {
  if (args.result.status === ECallStatus.Failed) throwFailure(args.result)
  return narrowValue<K>(args.result)
}

const narrowValue = <K extends OpName>(result: CallResult): OpValue<K> => {
  if (result.status === ECallStatus.Failed) throw new CallFailureError(result.error)
  return result.value as OpValue<K>
}

export const invoke = async <K extends OpName>(args: {
  calls: RemoteCalls
  op: Extract<CallOp, { op: K }>
  signal?: AbortSignal | undefined
  onOutput?: ((bytes: Uint8Array) => void) | undefined
  key?: string | undefined
  dispatchedBootId?: string | undefined
}): Promise<OpValue<K>> => {
  const dispatchedBootId = args.dispatchedBootId ?? scopeDispatchedBootId()
  const result = await args.calls.invoke({
    key: args.key ?? nextKey(),
    op: args.op,
    ...(args.signal === undefined ? {} : { signal: args.signal }),
    ...(args.onOutput === undefined ? {} : { onOutput: args.onOutput }),
    ...(dispatchedBootId === undefined ? {} : { dispatchedBootId }),
  })
  return valueFrom({ result, op: args.op.op })
}
