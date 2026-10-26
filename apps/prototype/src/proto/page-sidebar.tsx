'use client'

import { Input } from '@dltech/atlas-ui/components/input'
import { ScrollArea } from '@dltech/atlas-ui/components/scroll-area'
import { SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { filterTree, type TreeNode } from './page-tree'
import { splitFramePath } from './frame-path'
import { TreeView } from './tree-view'

export function PageSidebar({
  tree,
  currentPath,
  onSelect,
}: {
  tree: TreeNode[]
  currentPath: string
  onSelect: (url: string) => void
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => filterTree({ nodes: tree, query }), [tree, query])
  const isFiltering = query.trim() !== ''
  return (
    <aside className="flex h-full w-65 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col gap-2 p-3">
        <h2 className="text-sm font-medium">Pages</h2>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Filter pages"
            placeholder="Filter by URL or folder"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Pages" className="px-2 pb-3">
          {visible.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">No pages match “{query}”.</p>
          ) : (
            <TreeView
              nodes={visible}
              activePathname={splitFramePath(currentPath).pathname}
              isFiltering={isFiltering}
              onSelect={onSelect}
            />
          )}
        </nav>
      </ScrollArea>
    </aside>
  )
}
