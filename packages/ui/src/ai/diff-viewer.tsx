import type { CSSProperties, ReactNode } from 'react'

import { languageOfPath } from '#lib/language-of-path'
import { cn } from '#lib/utils'

import { useDiffHighlight } from './internal/diff-highlight'

const MINUS = '−'

export type DiffLineKind = 'add' | 'remove' | 'context' | 'gap'
export type DiffMode = 'inline' | 'split'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  oldNumber?: number
  newNumber?: number
}

export interface DiffViewerProps {
  path: string
  lines: DiffLine[]
  added?: number
  removed?: number
  mode?: DiffMode
  hunk?: string
  style?: CSSProperties
}

interface RowProps {
  line: DiffLine
  mode: DiffMode
  highlighted: ReactNode | null
}

interface GutterInput {
  line: DiffLine
  mode: DiffMode
}

export function gutterNumbers({ line, mode }: GutterInput): string[] {
  if (line.kind === 'gap') return ['⋯']
  if (mode === 'split') return [`${line.oldNumber ?? ''}`, `${line.newNumber ?? ''}`]
  return [`${line.newNumber ?? line.oldNumber ?? ''}`]
}

function Row({ line, mode, highlighted }: RowProps) {
  const added = line.kind === 'add'
  const removed = line.kind === 'remove'
  const gap = line.kind === 'gap'

  return (
    <div
      data-kind={line.kind}
      className={cn(
        'flex min-w-0',
        added && 'bg-diff-add',
        removed && 'bg-diff-remove',
        gap && 'bg-diff-band',
      )}
    >
      {gutterNumbers({ line, mode }).map((number, index) => (
        <span
          key={index}
          className="w-10 shrink-0 px-2 text-right text-diff-gutter tabular-nums select-none"
        >
          {number}
        </span>
      ))}
      <span
        className={cn(
          'w-5 shrink-0 text-center select-none',
          added && 'text-diff-add-foreground',
          removed && 'text-diff-remove-foreground',
          !added && !removed && 'text-diff-gutter',
        )}
      >
        {added ? '+' : removed ? MINUS : ' '}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate pr-3 whitespace-pre',
          gap ? 'text-muted-foreground italic' : 'text-foreground',
        )}
      >
        {highlighted ?? line.text}
      </span>
    </div>
  )
}

export function DiffViewer({
  path,
  lines,
  added,
  removed,
  mode = 'inline',
  hunk,
  style,
}: DiffViewerProps) {
  const highlighted = useDiffHighlight({ lines, language: languageOfPath(path) })

  return (
    <div
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card font-mono text-xs"
      style={style}
    >
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-3 py-1.5">
        <span className="flex-1 truncate text-muted-foreground">{path}</span>
        {added !== undefined ? (
          <span className="text-diff-add-foreground tabular-nums">+{added}</span>
        ) : null}
        {removed !== undefined ? (
          <span className="text-diff-remove-foreground tabular-nums">
            {MINUS}
            {removed}
          </span>
        ) : null}
      </div>
      {hunk ? (
        <div className="bg-diff-band px-3 py-0.5 font-semibold text-primary">{hunk}</div>
      ) : null}
      <div className="overflow-auto py-1 leading-relaxed">
        {lines.map((line, index) => (
          <Row key={index} line={line} mode={mode} highlighted={highlighted?.[index] ?? null} />
        ))}
      </div>
    </div>
  )
}
