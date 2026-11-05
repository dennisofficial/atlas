export class LeaseLostError extends Error {
  constructor(
    message: string,
    readonly refusal: string,
  ) {
    super(message)
    this.name = 'LeaseLostError'
  }
}
