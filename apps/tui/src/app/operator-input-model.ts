import type {
  OperatorInputReady,
  OperatorInputState,
  OperatorInputRequestView,
} from '../ui/operator-input-state'
import type { PendingOperatorRequest } from './operator-request'

export const operatorRequestViewOf = (
  request: PendingOperatorRequest,
): OperatorInputRequestView => ({
  requestId: request.callId,
  description: request.prompt,
})

export const awaitingStateOf = (args: {
  request: PendingOperatorRequest
  typed?: string
  failure?: string | null
}): OperatorInputReady => ({
  kind: 'awaiting',
  request: operatorRequestViewOf(args.request),
  typed: args.typed ?? '',
  failure: args.failure ?? null,
})

export const deliveringStateOf = (args: {
  request: OperatorInputRequestView
  typed: string
}): OperatorInputState => ({ kind: 'delivering', request: args.request, typed: args.typed })

export const failedStateOf = (args: {
  request: OperatorInputRequestView
  typed: string
  reason: string
}): OperatorInputReady => ({
  kind: 'awaiting',
  request: args.request,
  typed: args.typed,
  failure: args.reason,
})

export const requestChanged = (args: {
  before: OperatorInputState | null
  callId: string | null
}): boolean => {
  if (args.callId === null) return args.before !== null
  return args.before?.request.requestId !== args.callId
}
