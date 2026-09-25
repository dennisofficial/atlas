export enum EUnreadableReason {
  CorruptEnvelope = 'corrupt-envelope',
  MalformedJson = 'malformed-json',
  NewerVersion = 'newer-version',
  TruncatedTail = 'truncated-tail',
  UnrecognizedBody = 'unrecognized-body',
}

export type UnreadableRow = {
  id: string
  seq: number
  threadId: string
  type: string
  reason: EUnreadableReason
  detail: string
}
