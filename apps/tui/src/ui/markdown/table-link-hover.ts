import { RGBA, TextTableRenderable, type MarkdownRenderable, type Renderable, type TextTableContent } from '@opentui/core'
import { useEffect, type RefObject } from 'react'

import { linkHoverUrl, subscribeLinkHover } from '../../composition/link-click'
import { theme } from '../theme'

type Wash = { original: TextTableContent; applied: TextTableContent }

const washes = new WeakMap<TextTableRenderable, Wash>()

function tablesUnder(node: Renderable): TextTableRenderable[] {
  if (node instanceof TextTableRenderable) return [node]
  return node.getChildren().flatMap(tablesUnder)
}

function washedContent(args: { content: TextTableContent; url: string }): TextTableContent | null {
  const bg = RGBA.fromHex(theme.hoverBg)
  let touched = false
  const rows = args.content.map((row) =>
    row.map((cell) => {
      if (!cell?.some((chunk) => chunk.link?.url === args.url)) return cell
      touched = true
      return cell.map((chunk) => (chunk.link?.url === args.url ? { ...chunk, bg } : chunk))
    }),
  )
  return touched ? rows : null
}

export function paintTableHover(args: { table: TextTableRenderable; url: string | null }): void {
  const { table } = args
  const known = washes.get(table)
  const base = known !== undefined && known.applied === table.content ? known.original : table.content
  const next = args.url === null ? null : washedContent({ content: base, url: args.url })

  if (next === null) {
    washes.delete(table)
    if (base !== table.content) table.content = base
    return
  }
  washes.set(table, { original: base, applied: next })
  table.content = next
}

export function useTableLinkHover(ref: RefObject<MarkdownRenderable | null>): void {
  useEffect(() => {
    const paint = (url: string | null) => {
      const markdown = ref.current
      if (markdown === null || markdown.isDestroyed) return
      for (const table of tablesUnder(markdown)) paintTableHover({ table, url })
    }
    const release = subscribeLinkHover(() => paint(linkHoverUrl()))
    return () => {
      release()
      paint(null)
    }
  }, [ref])
}
