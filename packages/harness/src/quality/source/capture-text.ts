import {
  EQualitySkipReason,
  type CapturedFileChange,
  type QualityCoverageDiagnostic,
} from '@dltech/atlas-core'

export const MAX_CAPTURE_SOURCE_BYTES = 1024 * 1024

export type TextCapture =
  | { ok: true; text: string | null }
  | { ok: false; diagnostic: QualityCoverageDiagnostic }

export function captureText(args: {
  path: string
  text: string
  strict: string | null
  changed: boolean
}): TextCapture {
  const bytes = Buffer.byteLength(args.text, 'utf8')
  if (bytes > MAX_CAPTURE_SOURCE_BYTES) {
    return {
      ok: false,
      diagnostic: {
        path: args.path,
        reason: EQualitySkipReason.OversizedSource,
        detail: `${bytes} bytes exceeds the ${MAX_CAPTURE_SOURCE_BYTES} byte capture bound`,
      },
    }
  }
  if (args.strict === null) {
    return {
      ok: false,
      diagnostic: {
        path: args.path,
        reason: EQualitySkipReason.InvalidText,
        detail: 'the file is not valid UTF-8, so the captured text is lossy',
      },
    }
  }
  if (args.text !== args.strict) {
    return {
      ok: false,
      diagnostic: {
        path: args.path,
        reason: EQualitySkipReason.InvalidText,
        detail: 'the backend decode differs from the strict UTF-8 decode, so the captured text is not exact',
      },
    }
  }
  if (!args.changed) return { ok: true, text: null }
  return { ok: true, text: args.text }
}

export function captureUnavailableFault(args: { path: string; detail: string }): QualityCoverageDiagnostic {
  return { path: args.path, reason: EQualitySkipReason.SourceUnavailable, detail: args.detail }
}

export function makeChange(args: {
  path: string
  before: string | null
  after: string
}): readonly CapturedFileChange[] {
  return [{ path: args.path, before: args.before, after: args.after }]
}
