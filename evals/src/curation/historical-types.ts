export enum EHistoricalTool {
  Write = 'write',
  Edit = 'edit',
  MultiEdit = 'multi_edit',
}

export enum EHistoricalBasis {
  ProvableCreation = 'provable_creation',
  KnownPriorWrite = 'known_prior_write',
  KnownPriorDiffReplay = 'known_prior_diff_replay',
}

export enum EAfterEvidence {
  WriteByteChecked = 'write_byte_checked',
  DiffReplayOnly = 'diff_replay_only',
}

export enum EHistoricalRejection {
  MalformedEvent = 'malformed_event',
  ThreadMismatch = 'thread_mismatch',
  ThreadFileMismatch = 'thread_file_mismatch',
  DuplicateCallId = 'duplicate_call_id',
  DuplicateResultId = 'duplicate_result_id',
  OrphanResult = 'orphan_result',
  MissingResult = 'missing_result',
  CallResultMismatch = 'call_result_mismatch',
  ToolFailed = 'tool_failed',
  ToolInterrupted = 'tool_interrupted',
  ToolDenied = 'tool_denied',
  UnresolvedPath = 'unresolved_path',
  PathMismatch = 'path_mismatch',
  InvalidInput = 'invalid_input',
  InvalidOutput = 'invalid_output',
  ByteMismatch = 'byte_mismatch',
  AnchorContradiction = 'anchor_contradiction',
  MissingBefore = 'missing_before',
  CrlfBaseline = 'crlf_baseline',
  ReplayFailed = 'replay_failed',
  AlreadyApplied = 'already_applied',
  NoChange = 'no_change',
  InterleavedActivity = 'interleaved_activity',
}

export type HistoricalAnchorSource = { callId: string; resultSeq: number }

export type HistoricalChange = {
  path: string
  before: string | null
  after: string
  tool: EHistoricalTool
  threadId: string
  runId: string
  callId: string
  callSeq: number
  resultSeq: number
  callIndex: number
  resultIndex: number
  at: string
  beforeSha256: string | null
  afterSha256: string
  basis: EHistoricalBasis
  beforeSource: HistoricalAnchorSource | null
  afterEvidence: EAfterEvidence
}

export type HistoricalRejection = {
  kind: EHistoricalRejection
  detail: string
  index: number
  seq: number | null
  threadId: string | null
  callId: string | null
  path: string | null
}

export type HistoricalRecovery = {
  changes: HistoricalChange[]
  rejections: HistoricalRejection[]
}
