import type { ReactNode } from 'react'

import { cn } from '#lib/utils'

export const TREE_LEVEL_CLASS = 'ml-4 border-l pl-1'

export function TreeGuide({ children }: { children: ReactNode }) {
  return <div className={cn('flex flex-col', TREE_LEVEL_CLASS)}>{children}</div>
}

export function TreeGuideCells({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          data-tree-guide=""
          className={cn('shrink-0 self-stretch', TREE_LEVEL_CLASS)}
        />
      ))}
    </>
  )
}
