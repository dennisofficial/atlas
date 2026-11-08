export class StalledTurnError extends Error {
  override readonly name = 'StalledTurnError'

  constructor(minutes: number) {
    super(`no progress for ${minutes} minutes: the call was abandoned and recorded as stalled`)
  }
}
