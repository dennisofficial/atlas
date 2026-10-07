import type { QualityEvidence } from '@dltech/atlas-core'

import { mergeRedactionMaps, type RedactionMapEntry, type RedactionResult } from './redact'
import type { ExportedScope, RedactionMaps } from './exported-example'
import { exportedScopeOf, type SinkRecord } from './sink-record'

export type RedactedRecord = { path: string; scope: ExportedScope; redaction: RedactionMaps }

export type RedactOutcome = { ok: true; redacted: RedactedRecord } | { ok: false; unstableFields: readonly string[] }

export function redactSinkRecord({
  record,
  redact,
}: {
  record: SinkRecord
  redact: (text: string) => RedactionResult
}): RedactOutcome {
  const unstable = new Set<string>()
  const one = ({ field, text }: { field: string; text: string }): RedactionResult => {
    const first = redact(text)
    const second = redact(first.text)
    if (second.text !== first.text || second.map.length !== 0) unstable.add(field)
    return first
  }
  const nullable = ({ field, text }: { field: string; text: string | null }) =>
    text === null ? { text: null, map: [] as readonly RedactionMapEntry[] } : one({ field, text })
  const many = ({ field, texts }: { field: string; texts: readonly string[] }) => {
    const results = texts.map((text) => one({ field, text }))
    return { texts: results.map((result) => result.text), map: mergeRedactionMaps({ maps: results.map((result) => result.map) }) }
  }

  const source = exportedScopeOf({ record })
  const path = one({ field: 'path', text: record.path })
  const name = one({ field: 'name', text: source.name })
  const before = nullable({ field: 'before', text: source.before })
  const after = nullable({ field: 'after', text: source.after })
  const diff = one({ field: 'diff', text: source.diff })
  const context = many({ field: 'dependencyContext', texts: source.dependencyContext })
  const evidenceTexts = many({ field: 'evidence', texts: source.evidence.flatMap((entry) => [entry.id, entry.label]) })
  const evidence: QualityEvidence[] = source.evidence.map((entry, index) => ({
    id: evidenceTexts.texts[index * 2] ?? entry.id,
    label: evidenceTexts.texts[index * 2 + 1] ?? entry.label,
    changed: entry.changed,
  }))

  if (unstable.size > 0) return { ok: false, unstableFields: [...unstable].sort() }
  return {
    ok: true,
    redacted: {
      path: path.text,
      scope: {
        ...source,
        name: name.text,
        before: before.text,
        after: after.text,
        diff: diff.text,
        dependencyContext: context.texts,
        evidence,
      },
      redaction: {
        path: path.map,
        name: name.map,
        before: before.map,
        after: after.map,
        diff: diff.map,
        dependencyContext: context.map,
        evidence: evidenceTexts.map,
      },
    },
  }
}
