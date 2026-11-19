export const AWAITING_ACCESS = 'AWAITING_ACCESS'

export class AwaitingAccessError extends Error {
  readonly code = AWAITING_ACCESS

  constructor() {
    super('Atlas Cloud is invite-only right now; your account is awaiting access')
  }
}
