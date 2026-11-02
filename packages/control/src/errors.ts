export class UnknownThreadError extends Error {
  constructor(threadId: string) {
    super(`unknown thread ${threadId}`)
    this.name = 'UnknownThreadError'
  }
}

export class LeaseConflictError extends Error {
  constructor(sessionId: string) {
    super(`lease for ${sessionId} changed concurrently`)
    this.name = 'LeaseConflictError'
  }
}
