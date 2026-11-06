export class CallInterruptedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CallInterruptedError'
  }
}
