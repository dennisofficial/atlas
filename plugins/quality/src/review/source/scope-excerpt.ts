import type { QualityScope } from '@dltech/atlas-core'

import { renderScopeDiff } from './scope-diff'
import { parseQualitySource } from './typescript-parser'

export const EXCERPT_CONTEXT_LINES = 25
export const MAX_EXCERPT_LINES = 90
export const MAX_OUTLINE_ENTRIES = 60
export const MAX_EVIDENCE_ENTRIES = 32

export type QualityScopeExcerpt = {
  reason: 'oversized'
  contextLines: number
  beforeStartLine: number
  afterStartLine: number
  beforeOmittedLines: number
  afterOmittedLines: number
  outline: readonly string[]
}

export type ExcerptedScope = { scope: QualityScope; excerpt: QualityScopeExcerpt }

type Window = { from: number; to: number }

function splitLines(text: string | null): readonly string[] {
  if (text === null || text === '') return []
  return text.split('\n')
}

function commonHeadLength(before: readonly string[], after: readonly string[]): number {
  const shortest = Math.min(before.length, after.length)
  let head = 0
  while (head < shortest && before[head] === after[head]) head += 1
  return head
}

function commonTailLength(args: {
  before: readonly string[]
  after: readonly string[]
  head: number
}): number {
  const available = Math.min(args.before.length, args.after.length) - args.head
  let tail = 0
  while (tail < available) {
    if (args.before[args.before.length - 1 - tail] !== args.after[args.after.length - 1 - tail])
      break
    tail += 1
  }
  return tail
}

function windowOf(args: {
  from: number
  to: number
  length: number
  contextLines: number
}): Window {
  const last = Math.max(args.length - 1, 0)
  return {
    from: Math.max(0, Math.min(args.from, last) - args.contextLines),
    to: Math.min(last, Math.min(args.to, last) + args.contextLines),
  }
}

function cut(args: { lines: readonly string[]; window: Window }): {
  text: string
  omitted: number
} {
  const window = args.lines.slice(args.window.from, args.window.to + 1)
  if (window.length === 0) return { text: '', omitted: 0 }
  if (window.length <= MAX_EXCERPT_LINES) return { text: window.join('\n'), omitted: 0 }
  const head = Math.ceil(MAX_EXCERPT_LINES / 2)
  const tail = MAX_EXCERPT_LINES - head
  const omitted = window.length - MAX_EXCERPT_LINES
  const text = [
    ...window.slice(0, head),
    `// ... ${omitted} lines omitted ...`,
    ...window.slice(window.length - tail),
  ].join('\n')
  return { text, omitted }
}

function outlineOf(scope: QualityScope): readonly string[] {
  const text = scope.after ?? scope.before
  if (text === null) return []
  const parsed = parseQualitySource({ path: scope.path, text })
  if (!parsed.ok) return []
  const root =
    parsed.source.declarations.find(
      (declaration) => declaration.kind === scope.kind && declaration.name === scope.name,
    ) ?? parsed.source.declarations[0]
  if (root === undefined) return []
  const members = parsed.source.declarations.filter(
    (declaration) => declaration.parentQualifiedName === root.qualifiedName,
  )
  const declaredNames = new Set(members.map((member) => member.name))
  const entries = [
    ...members.map(
      (member) =>
        `${member.kind} ${member.qualifiedName} lines ${member.lineRange.start}-${member.lineRange.end}`,
    ),
    ...root.memberLabels
      .filter((label) => !declaredNames.has(label))
      .map((label) => `field ${label}`),
  ]
  if (entries.length <= MAX_OUTLINE_ENTRIES) return entries
  return [
    ...entries.slice(0, MAX_OUTLINE_ENTRIES),
    `${entries.length - MAX_OUTLINE_ENTRIES} more members`,
  ]
}

function evidenceOf(scope: QualityScope): QualityScope['evidence'] {
  if (scope.evidence.length <= MAX_EVIDENCE_ENTRIES) return scope.evidence
  const own = scope.evidence.filter(
    (entry) => entry.label === scope.name || entry.id.endsWith(`#${scope.name}`),
  )
  const changed = scope.evidence.filter((entry) => entry.changed)
  const kept = [...own, ...changed].filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index,
  )
  return kept.slice(0, MAX_EVIDENCE_ENTRIES)
}

export function excerptOf(args: { scope: QualityScope; contextLines?: number }): ExcerptedScope {
  const contextLines = args.contextLines ?? EXCERPT_CONTEXT_LINES
  const { scope } = args
  const before = splitLines(scope.before)
  const after = splitLines(scope.after)
  const head = commonHeadLength(before, after)
  const tail = commonTailLength({ before, after, head })
  const beforeChanged = { from: head, to: before.length - 1 - tail }
  const afterChanged = { from: head, to: after.length - 1 - tail }
  const beforeWindow = windowOf({
    from: beforeChanged.from,
    to: beforeChanged.to,
    length: before.length,
    contextLines,
  })
  const afterWindow = windowOf({
    from: afterChanged.from,
    to: afterChanged.to,
    length: after.length,
    contextLines,
  })
  const beforeCut = cut({ lines: before, window: beforeWindow })
  const afterCut = cut({ lines: after, window: afterWindow })
  const beforeText = beforeCut.text
  const afterText = afterCut.text
  const excerpted: QualityScope = {
    ...scope,
    evidence: evidenceOf(scope),
    before: before.length === 0 ? scope.before : beforeText,
    after: after.length === 0 ? scope.after : afterText,
    diff: renderScopeDiff({
      path: scope.path,
      before: before.length === 0 ? scope.before : beforeText,
      after: after.length === 0 ? scope.after : afterText,
    }),
  }
  return {
    scope: excerpted,
    excerpt: {
      reason: 'oversized',
      contextLines,
      beforeStartLine: beforeWindow.from + 1,
      afterStartLine: afterWindow.from + 1,
      beforeOmittedLines: Math.max(
        0,
        before.length - (beforeWindow.to - beforeWindow.from + 1) + beforeCut.omitted,
      ),
      afterOmittedLines: Math.max(
        0,
        after.length - (afterWindow.to - afterWindow.from + 1) + afterCut.omitted,
      ),
      outline: outlineOf(scope),
    },
  }
}
