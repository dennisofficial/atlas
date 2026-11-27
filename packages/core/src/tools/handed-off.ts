export class CallHandedOffError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CallHandedOffError'
  }
}
