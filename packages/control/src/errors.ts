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

export class MainThreadOnlyKindError extends Error {
  constructor(kind: string) {
    super(`inbox kind "${kind}" can only be posted on the main thread`)
    this.name = 'MainThreadOnlyKindError'
  }
}
