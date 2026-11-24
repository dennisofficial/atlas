import {
  EDaemonAnswer,
  interruptedByRestartMessage,
  recoverCall,
  type RecoverAction,
  type RecoverAnswer,
} from '@dltech/atlas-core'

export const SANDBOX_OFFLINE_GUIDANCE =
  'The sandbox is offline, so retrying tool calls will not help: stop making sandbox tool calls, tell the operator the sandbox is down and why, and end your turn.'

export class SandboxUnavailableError extends Error {
  constructor(reason: string) {
    super(`${reason}. Nothing ran. ${SANDBOX_OFFLINE_GUIDANCE}`)
    this.name = 'SandboxUnavailableError'
  }
}

export class FencedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FencedError'
  }
}

export class OpMismatchError extends Error {
  constructor(args: { key: string; expected: string; actual: string }) {
    super(
      `result for ${args.key} names op ${args.actual}, not the requested ${args.expected}: the replay diverged`,
    )
    this.name = 'OpMismatchError'
  }
}

export class ProtocolViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolViolationError'
  }
}

export const isReadOnlyOp = (op: string): boolean => READ_ONLY_OPS.has(op)

const READ_ONLY_OPS = new Set([
  'stat',
  'readFile',
  'readBytes',
  'readTextForEdit',
  'readLink',
  'readDirectory',
  'glob',
  'grep',
])

export const resizeInterruptReason = (args: { vcpus: number; memoryGb: number }): string =>
  `the pod is being resized to ${args.vcpus} vCPU / ${args.memoryGb} GB`

export const resizeInterruptedMessage = (args: { reason: string }): string =>
  `This call was interrupted because ${args.reason}. Try again now: the next call waits until the resize finishes.`

export type DaemonAnswer = RecoverAnswer

export const actionForAnswer = (args: {
  op: string
  dispatchedBootId: string | undefined
  currentBootId: string | undefined
  answer: DaemonAnswer
}): RecoverAction =>
  recoverCall({
    facts: {
      dispatched: true,
      dispatchedBootId: args.dispatchedBootId,
      resultRecorded: false,
      readOnly: isReadOnlyOp(args.op),
    },
    answer: args.answer,
    bootId: args.currentBootId ?? '',
    variant: { doneRuns: true },
  })

export const needsRun = (action: RecoverAction): boolean =>
  action.type === 'run' || action.type === 'rerun' || action.type === 'attach'

export const actionForLostCall = (args: {
  op: string
  dispatchedBootId: string
  currentBootId: string
}): { rerun: boolean } => {
  const action = recoverCall({
    facts: {
      dispatched: true,
      dispatchedBootId: args.dispatchedBootId,
      resultRecorded: false,
      readOnly: isReadOnlyOp(args.op),
    },
    answer: EDaemonAnswer.NeverSeen,
    bootId: args.currentBootId,
  })
  return { rerun: action.type === 'rerun' || action.type === 'run' }
}

export const callLostAcrossBoot = (args: {
  op: string
  dispatchedBootId: string | undefined
  currentBootId: string | undefined
}): boolean => {
  if (args.dispatchedBootId === undefined || args.currentBootId === undefined) return false
  if (args.dispatchedBootId === args.currentBootId) return false
  return !actionForLostCall({
    op: args.op,
    dispatchedBootId: args.dispatchedBootId,
    currentBootId: args.currentBootId,
  }).rerun
}

export const interruptedMessage = interruptedByRestartMessage

export class ReadyTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the sandbox did not answer within ${Math.ceil(timeoutMs / 1000)}s`)
    this.name = 'ReadyTimeoutError'
  }
}
