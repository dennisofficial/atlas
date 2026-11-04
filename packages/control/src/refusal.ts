import type { AppendRefusal, InboxRefusal, LogHead } from '@dltech/atlas-core'

export type BlobRefusal = { kind: 'blob-mismatch' | 'blob-missing'; hash: string }

export type ControlRefusal = AppendRefusal | InboxRefusal | BlobRefusal

export type AppendOutcome =
  | { ok: true; head: LogHead }
  | { ok: false; refusal: ControlRefusal; head: LogHead }

export class AppendAbort extends Error {
  constructor(
    readonly refusal: ControlRefusal,
    readonly head: LogHead,
  ) {
    super('append aborted')
    this.name = 'AppendAbort'
  }
}

export class RecordCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordCorruptError'
  }
}
