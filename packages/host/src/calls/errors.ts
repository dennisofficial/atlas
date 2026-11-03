import { EDaemonAnswer, recoverCall } from '@dltech/atlas-core'

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message)
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

const crashedCallMessage = (op: string): string =>
  `${op} was interrupted by a process restart before its result was recorded; its effects are unknown — check before repeating it`

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

export const interruptedMessage = crashedCallMessage
