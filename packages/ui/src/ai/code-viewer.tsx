'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { loadHighlighter } from '#lib/highlighter'
import { cn } from '#lib/utils'

export type CodeLineMark = 'added' | 'modified' | 'deleted-above' | 'deleted-below'

export const HIGHLIGHT_LINE_LIMIT = 5000

export interface CodeViewerProps {
  path: string
  content: string
  language: string | null
  marks?: ReadonlyMap<number, CodeLineMark>
}

const MARK_LABEL: Record<CodeLineMark, string> = {
  added: 'Added line',
  modified: 'Modified line',
  'deleted-above': 'Lines deleted above',
  'deleted-below': 'Lines deleted below',
}

export function linesOf(content: string): string[] {
  const lines = content.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function normalizedMarks(args: {
  marks: ReadonlyMap<number, CodeLineMark>
  lineCount: number
}): Map<number, CodeLineMark> {
  const { marks, lineCount } = args
  const result = new Map<number, CodeLineMark>()
  for (const [line, mark] of marks) {
    if (line >= 1 && line <= lineCount) result.set(line, mark)
    else if (line > lineCount && mark === 'deleted-above' && lineCount > 0) {
      if (!result.has(lineCount)) result.set(lineCount, 'deleted-below')
    }
  }
  return result
}

function useHighlightedLines(args: { content: string; language: string | null; enabled: boolean }) {
  const { content, language, enabled } = args
  const [result, setResult] = useState<{ content: string; lines: ReactNode[] } | null>(null)

  useEffect(() => {
    if (!enabled || language === null) return undefined
    let cancelled = false
    loadHighlighter(language)
      .then((highlighter) => {
        if (cancelled || highlighter === null) return
        setResult({ content, lines: highlighter.highlight(content).lines })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [content, language, enabled])

  return result?.content === content ? result.lines : null
}

function MarkBar({ mark }: { mark: CodeLineMark | undefined }) {
  if (mark === undefined) return <span aria-hidden className="w-1 shrink-0" />
  const deleted = mark.startsWith('deleted')
  return (
    <span
      data-mark={mark}
      className={cn(
        'relative w-1 shrink-0',
        mark === 'added' && 'bg-diff-add-foreground',
        mark === 'modified' && 'bg-warning',
      )}
    >
      <span className="sr-only">{MARK_LABEL[mark]}</span>
      {deleted ? (
        <span
          aria-hidden
          className={cn(
            'absolute left-0 size-0 border-y-4 border-l-4 border-y-transparent border-l-diff-remove-foreground',
            mark === 'deleted-above' ? '-top-1' : '-bottom-1',
          )}
        />
      ) : null}
    </span>
  )
}

export function CodeViewer({ path, content, language, marks }: CodeViewerProps) {
  const lines = linesOf(content)
  const tooLarge = lines.length > HIGHLIGHT_LINE_LIMIT
  const highlighted = useHighlightedLines({ content, language, enabled: !tooLarge })
  const lineMarks = normalizedMarks({ marks: marks ?? new Map(), lineCount: lines.length })
  const digits = `${lines.length}`.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section
        aria-label={`Contents of ${path}`}
        className="min-h-0 flex-1 overflow-auto bg-background py-2 font-mono text-xs leading-relaxed"
      >
        <div className="w-max min-w-full">
          {lines.map((text, index) => {
            const number = index + 1
            return (
              <div key={number} data-line={number} className="flex">
                <span className="sticky left-0 z-10 flex shrink-0 bg-background select-none">
                  <MarkBar mark={lineMarks.get(number)} />
                  <span
                    className="px-3 text-right text-diff-gutter tabular-nums"
                    style={{ minWidth: `${digits + 2}ch` }}
                  >
                    {number}
                  </span>
                </span>
                <span className="pr-4 whitespace-pre text-foreground">
                  {highlighted?.[index] ?? text}
                  {text === '' ? ' ' : null}
                </span>
              </div>
            )
          })}
        </div>
      </section>
      {tooLarge ? (
        <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground">
          Syntax highlighting is off for files over {HIGHLIGHT_LINE_LIMIT.toLocaleString('en-US')}{' '}
          lines.
        </p>
      ) : null}
    </div>
  )
}
