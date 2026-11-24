export class CallInterruptedError extends Error {
  readonly modelMessage: string | undefined

  constructor(args: { message: string; modelMessage?: string | undefined }) {
    super(args.message)
    this.name = 'CallInterruptedError'
    this.modelMessage = args.modelMessage
  }
}
