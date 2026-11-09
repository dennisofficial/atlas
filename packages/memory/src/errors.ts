import { MEMORY_STALE_REVISION_CODE } from '@dltech/atlas-wire'

export class MemoryInvalidError extends Error {}

export class MemoryNotFoundError extends Error {
  constructor() {
    super('no such memory')
  }
}

export class MemoryStaleRevisionError extends Error {
  readonly code = MEMORY_STALE_REVISION_CODE
  readonly current: number

  constructor(args: { expected: number; current: number }) {
    super(`memory is at revision ${args.current}, not ${args.expected}; read it again`)
    this.current = args.current
  }
}

export class MemoryEditRefusedError extends Error {
  readonly code: string

  constructor(args: { message: string; code: string }) {
    super(args.message)
    this.code = args.code
  }
}
