import { ScrollBoxRenderable, type BoxRenderable, type Renderable } from '@opentui/core'
import { useEffect, type RefObject } from 'react'
import type { ContextTreeRow } from '../context-tree-model'

export function useContextTreeReveal(args: {
  root: RefObject<BoxRenderable | null>
  rows: readonly ContextTreeRow[]
  cursor: string | null
  focused: boolean
}): void {
  useEffect(() => {
    const root = args.root.current
    if (!args.focused || root === null || args.cursor === null) return
    const index = args.rows.findIndex((row) => row.path === args.cursor)
    if (index < 0) return
    let parent: Renderable | null = root.parent
    while (parent !== null && !(parent instanceof ScrollBoxRenderable)) parent = parent.parent
    if (parent === null) return
    const top = root.y - parent.viewport.y + parent.scrollTop + index + 1
    const bottom = top + 1
    if (top < parent.scrollTop) parent.scrollTo(top)
    else if (bottom > parent.scrollTop + parent.viewport.height) parent.scrollTo(bottom - parent.viewport.height)
  }, [args.root, args.rows, args.cursor, args.focused])
}
