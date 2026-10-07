import { posix } from 'node:path'

import { sha256Hex } from '../hash'
import { parseDiffOutput, parseWriteOutput } from './historical-events'
import {
  EAfterEvidence,
  EHistoricalBasis,
  EHistoricalRejection,
  EHistoricalTool,
  type HistoricalAnchorSource,
  type HistoricalChange,
} from './historical-types'
import { applyUnifiedDiff, EReconstructionKind } from './reconstruct'

export type FileCall = {
  tool: EHistoricalTool
  path: string
  content: string | null
  threadId: string
  runId: string
  callId: string
  seq: number
  index: number
}

export type FileResult = { output: unknown; seq: number; index: number; at: string }

export type Anchor = { text: string; source: HistoricalAnchorSource }

export type Anchors = Map<string, Anchor>

export type ApplyOutcome = { change: HistoricalChange } | { kind: EHistoricalRejection; detail: string }

type ApplyArgs = { call: FileCall; result: FileResult; anchors: Anchors }

const digest = (text: string | null): string | null => (text === null ? null : sha256Hex({ text }))

const sourceOf = ({ call, result }: Pick<ApplyArgs, 'call' | 'result'>): HistoricalAnchorSource => ({
  callId: call.callId,
  resultSeq: result.seq,
})

function refuse({ anchors, call, kind, detail }: { anchors: Anchors; call: FileCall; kind: EHistoricalRejection; detail: string }): ApplyOutcome {
  anchors.delete(call.path)
  return { kind, detail }
}

function recorded({
  call,
  result,
  before,
  after,
  basis,
  beforeSource,
  afterEvidence,
}: Pick<ApplyArgs, 'call' | 'result'> & {
  before: string | null
  after: string
  basis: EHistoricalBasis
  beforeSource: HistoricalAnchorSource | null
  afterEvidence: EAfterEvidence
}): HistoricalChange {
  return {
    path: call.path,
    before,
    after,
    tool: call.tool,
    threadId: call.threadId,
    runId: call.runId,
    callId: call.callId,
    callSeq: call.seq,
    resultSeq: result.seq,
    callIndex: call.index,
    resultIndex: result.index,
    at: result.at,
    beforeSha256: digest(before),
    afterSha256: sha256Hex({ text: after }),
    basis,
    beforeSource,
    afterEvidence,
  }
}

const namesCallPath = ({ outputPath, call }: { outputPath: string; call: FileCall }): boolean =>
  outputPath.startsWith('/') && posix.resolve(outputPath) === call.path

function applyWrite({ call, result, anchors }: ApplyArgs): ApplyOutcome {
  const output = parseWriteOutput({ output: result.output })
  const { content } = call
  if (output === null || content === null) return refuse({ anchors, call, kind: EHistoricalRejection.InvalidOutput, detail: 'write output is not {path, created, bytes}' })
  if (!namesCallPath({ outputPath: output.path, call })) {
    return refuse({ anchors, call, kind: EHistoricalRejection.PathMismatch, detail: 'write output path differs from the input path' })
  }
  if (output.bytes !== Buffer.byteLength(content, 'utf8')) {
    return refuse({ anchors, call, kind: EHistoricalRejection.ByteMismatch, detail: 'write output byte count differs from the input content' })
  }
  const prior = anchors.get(call.path)
  const next: Anchor = { text: content, source: sourceOf({ call, result }) }
  anchors.set(call.path, next)
  if (output.created) {
    if (prior !== undefined) {
      anchors.delete(call.path)
      return { kind: EHistoricalRejection.AnchorContradiction, detail: 'write reports creating a file that earlier events established as existing' }
    }
    return {
      change: recorded({
        call,
        result,
        before: null,
        after: content,
        basis: EHistoricalBasis.ProvableCreation,
        beforeSource: null,
        afterEvidence: EAfterEvidence.WriteByteChecked,
      }),
    }
  }
  if (prior === undefined) return { kind: EHistoricalRejection.MissingBefore, detail: 'overwrite of a file with no known prior content' }
  if (prior.text === content) return { kind: EHistoricalRejection.NoChange, detail: 'write left the known content unchanged' }
  return {
    change: recorded({
      call,
      result,
      before: prior.text,
      after: content,
      basis: EHistoricalBasis.KnownPriorWrite,
      beforeSource: prior.source,
      afterEvidence: EAfterEvidence.WriteByteChecked,
    }),
  }
}

const headerNamesPath = ({ diff, path }: { diff: string; path: string }): boolean => {
  const [oldHeader, newHeader] = diff.split('\n')
  return newHeader === `+++ ${path}` && (oldHeader === `--- ${path}` || oldHeader === '--- /dev/null')
}

const hasHunks = ({ diff }: { diff: string }): boolean => diff.split('\n').some((row) => row.startsWith('@@ '))

function applyDiff({ call, result, anchors }: ApplyArgs): ApplyOutcome {
  const fail = ({ kind, detail }: { kind: EHistoricalRejection; detail: string }): ApplyOutcome => refuse({ anchors, call, kind, detail })
  const output = parseDiffOutput({ output: result.output })
  if (output === null) return fail({ kind: EHistoricalRejection.InvalidOutput, detail: 'edit output is not {path, diff}' })
  if (!namesCallPath({ outputPath: output.path, call }) || !headerNamesPath({ diff: output.diff, path: call.path })) {
    return fail({ kind: EHistoricalRejection.PathMismatch, detail: 'edit output or diff header names a different path' })
  }
  if (!hasHunks({ diff: output.diff })) return fail({ kind: EHistoricalRejection.NoChange, detail: 'diff contains no hunks' })
  const prior = anchors.get(call.path)
  if (prior === undefined) return fail({ kind: EHistoricalRejection.MissingBefore, detail: 'edit of a file with no known prior content' })
  if (prior.text.includes('\r')) return fail({ kind: EHistoricalRejection.CrlfBaseline, detail: 'baseline contains carriage returns; the stored diff is line-ending normalised' })
  const replay = applyUnifiedDiff({ before: prior.text, diff: output.diff })
  if (replay.kind === EReconstructionKind.AlreadyApplied) return fail({ kind: EHistoricalRejection.AlreadyApplied, detail: 'diff is already applied to the known baseline' })
  if (replay.kind === EReconstructionKind.Failed || replay.after === null) return fail({ kind: EHistoricalRejection.ReplayFailed, detail: 'diff does not apply to the known baseline' })
  if (replay.after === prior.text) return fail({ kind: EHistoricalRejection.NoChange, detail: 'replayed diff leaves the content unchanged' })
  anchors.set(call.path, { text: replay.after, source: sourceOf({ call, result }) })
  return {
    change: recorded({
      call,
      result,
      before: prior.text,
      after: replay.after,
      basis: EHistoricalBasis.KnownPriorDiffReplay,
      beforeSource: prior.source,
      afterEvidence: EAfterEvidence.DiffReplayOnly,
    }),
  }
}

export const applyFileResult = (args: ApplyArgs): ApplyOutcome =>
  args.call.tool === EHistoricalTool.Write ? applyWrite(args) : applyDiff(args)
