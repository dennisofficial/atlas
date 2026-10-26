'use client'

import { Collapsible, CollapsibleContent } from './ui/collapsible'
import { FileIcon } from 'lucide-react'
import { useState } from 'react'

import { splitFramePath } from './frame-path'
import { ENodeType, type FolderNode, type PageNode, type TreeNode } from './page-tree'
import { patternMatchesPath } from './route-samples'
import { TreeFolderRow } from './tree-folder-row'
import { cn } from './ui/utils'

interface TreeContext {
  activePathname: string
  forceOpen: boolean
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  onSelect: (url: string) => void
}

function PageRow({ node, context }: { node: PageNode; context: TreeContext }) {
  const isActive = node.pattern
    ? patternMatchesPath({ pattern: node.pattern, pathname: context.activePathname })
    : splitFramePath(node.url).pathname === context.activePathname
  const handleClick = () => context.onSelect(node.url)
  return (
    <button
      type="button"
      title={node.url}
      aria-current={isActive ? 'page' : undefined}
      onClick={handleClick}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        isActive
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground',
      )}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn('truncate', node.pattern && 'proto-mono text-xs')}>{node.label}</span>
    </button>
  )
}

function FolderBranch({ node, context }: { node: FolderNode; context: TreeContext }) {
  const open = context.forceOpen || !context.collapsed.has(node.id)
  const handleOpenChange = () => context.onToggle(node.id)
  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <TreeFolderRow node={node} open={open} />
      <CollapsibleContent>
        <div className="ml-3.5 border-l border-sidebar-border pl-1">
          <TreeNodes nodes={node.children} context={context} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function TreeNodes({ nodes, context }: { nodes: TreeNode[]; context: TreeContext }) {
  return (
    <div className="flex flex-col gap-px">
      {nodes.map((node) =>
        node.type === ENodeType.Page ? (
          <PageRow key={node.id} node={node} context={context} />
        ) : (
          <FolderBranch key={node.id} node={node} context={context} />
        ),
      )}
    </div>
  )
}

export function TreeView({
  nodes,
  activePathname,
  isFiltering,
  onSelect,
}: {
  nodes: TreeNode[]
  activePathname: string
  isFiltering: boolean
  onSelect: (url: string) => void
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const handleToggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const context: TreeContext = {
    activePathname,
    forceOpen: isFiltering,
    collapsed,
    onToggle: handleToggle,
    onSelect,
  }
  return <TreeNodes nodes={nodes} context={context} />
}
