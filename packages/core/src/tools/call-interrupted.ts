export const interruptedByRestartMessage = (op: string): string =>
  `${op} was interrupted by a daemon restart before its result was recorded; its effects are unknown — check before repeating it`

export class CallInterruptedError extends Error {
  readonly modelMessage: string | undefined

  constructor(args: { message: string; modelMessage?: string | undefined }) {
    super(args.message)
    this.name = 'CallInterruptedError'
    this.modelMessage = args.modelMessage
  }
}
