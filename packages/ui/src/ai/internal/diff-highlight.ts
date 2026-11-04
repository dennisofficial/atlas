'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { loadHighlighter } from '#lib/highlighter'

import type { DiffLine } from '../diff-viewer'

export interface DiffSide {
  texts: string[]
  rows: number[]
}

export interface DiffSides {
  older: DiffSide
  newer: DiffSide
}

export function diffSides(lines: readonly DiffLine[]): DiffSides {
  const older: DiffSide = { texts: [], rows: [] }
  const newer: DiffSide = { texts: [], rows: [] }
  lines.forEach((line, index) => {
    if (line.kind === 'gap') return
    if (line.kind !== 'add') {
      older.rows.push(index)
      older.texts.push(line.text)
    }
    if (line.kind !== 'remove') {
      newer.rows.push(index)
      newer.texts.push(line.text)
    }
  })
  return { older, newer }
}

export function placeHighlighted(args: {
  lineCount: number
  sides: readonly { side: DiffSide; highlighted: readonly ReactNode[] }[]
}): (ReactNode | null)[] {
  const rows: (ReactNode | null)[] = Array.from({ length: args.lineCount }, () => null)
  for (const { side, highlighted } of args.sides) {
    side.rows.forEach((row, index) => {
      rows[row] = highlighted[index] ?? null
    })
  }
  return rows
}

interface HighlightedSides {
  language: string
  olderText: string
  newerText: string
  older: ReactNode[]
  newer: ReactNode[]
}

export function useDiffHighlight(args: {
  lines: readonly DiffLine[]
  language: string | null
}): (ReactNode | null)[] | null {
  const { lines, language } = args
  const sides = useMemo(() => diffSides(lines), [lines])
  const olderText = sides.older.texts.join('\n')
  const newerText = sides.newer.texts.join('\n')
  const [result, setResult] = useState<HighlightedSides | null>(null)

  useEffect(() => {
    if (language === null) return undefined
    let cancelled = false
    loadHighlighter(language)
      .then((highlighter) => {
        if (cancelled || highlighter === null) return
        setResult({
          language,
          olderText,
          newerText,
          older: highlighter.highlight(olderText).lines,
          newer: highlighter.highlight(newerText).lines,
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [language, olderText, newerText])

  const current =
    result !== null &&
    result.language === language &&
    result.olderText === olderText &&
    result.newerText === newerText
  if (!current) return null

  return placeHighlighted({
    lineCount: lines.length,
    sides: [
      { side: sides.older, highlighted: result.older },
      { side: sides.newer, highlighted: result.newer },
    ],
  })
}
