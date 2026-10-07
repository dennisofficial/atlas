import { RGBA, rgbToHex, TextTableRenderable, type MarkdownRenderable, type Renderable, type TextChunk, type TextTableContent } from '@opentui/core'
import { useLayoutEffect, type RefObject } from 'react'
import { useRenderer } from '@opentui/react'

import { linkHoverUrl, subscribeLinkHover } from '../../composition/link-click'
import { linkHoverStyle } from '../link-hover-style'
import { theme } from '../theme'

type Decorated = { original: TextTableContent; applied: TextTableContent }

const decorated = new WeakMap<TextTableRenderable, Decorated>()

const upperCells = new WeakMap<TextChunk[], TextChunk[]>()

function tablesUnder(node: Renderable): TextTableRenderable[] {
  if (node instanceof TextTableRenderable) return [node]
  return node.getChildren().flatMap(tablesUnder)
}

function upperHeaderCell(cell: TextChunk[]): TextChunk[] {
  const known = upperCells.get(cell)
  if (known !== undefined) return known
  const upper = cell.map((chunk) => ({ ...chunk, text: chunk.text.toUpperCase() }))
  upperCells.set(cell, upper)
  return upper
}

function invert(chunk: TextChunk): TextChunk {
  const style = linkHoverStyle(chunk.fg === undefined ? theme.link : rgbToHex(chunk.fg))
  return { ...chunk, fg: RGBA.fromHex(style.fg), bg: RGBA.fromHex(style.bg) }
}

function washCell(args: { cell: TextChunk[]; url: string }): TextChunk[] {
  if (!args.cell.some((chunk) => chunk.link?.url === args.url)) return args.cell
  return args.cell.map((chunk) => (chunk.link?.url === args.url ? invert(chunk) : chunk))
}

function decorate(args: { content: TextTableContent; url: string | null }): TextTableContent {
  return args.content.map((row, rowIndex) =>
    row.map((cell) => {
      if (!Array.isArray(cell)) return cell
      const shaped = rowIndex === 0 ? upperHeaderCell(cell) : cell
      return args.url === null ? shaped : washCell({ cell: shaped, url: args.url })
    }),
  )
}

export function paintTableHover(args: { table: TextTableRenderable; url: string | null }): void {
  const { table } = args
  const known = decorated.get(table)
  const original = known !== undefined && known.applied === table.content ? known.original : table.content
  const applied = decorate({ content: original, url: args.url })
  const unchanged = applied.length === table.content.length && applied.every((row, index) => {
    const current = table.content[index]
    return current !== undefined && row.length === current.length && row.every((cell, column) => cell === current[column])
  })
  if (unchanged) return
  decorated.set(table, { original, applied })
  table.content = applied
}

export function useTableLinkHover(args: {
  ref: RefObject<MarkdownRenderable | null>
  content: string
}): void {
  const { ref, content } = args
  const renderer = useRenderer()
  useLayoutEffect(() => {
    const paint = () => {
      const markdown = ref.current
      if (markdown === null || markdown.isDestroyed) return
      for (const table of tablesUnder(markdown)) paintTableHover({ table, url: linkHoverUrl() })
    }
    paint()
    const release = subscribeLinkHover(paint)
    renderer.on('capabilities', paint)
    return () => {
      release()
      renderer.off('capabilities', paint)
    }
  }, [ref, content, renderer])
}
