'use client'

import { ChevronRightIcon, FileIcon, FolderIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'
import { cn } from '#lib/utils'

export enum EFileChange {
  Added = 'added',
  Modified = 'modified',
  Deleted = 'deleted',
}

export interface FileNode {
  path: string
  name: string
  children?: FileNode[]
  change?: EFileChange
}

export interface FileTreeProps {
  nodes: FileNode[]
  selected?: string
  onSelect?: (path: string) => void
  defaultOpen?: boolean
}

interface NodeProps {
  node: FileNode
  selected?: string
  onSelect?: (path: string) => void
  defaultOpen: boolean
}

const CHANGE_MARK: Record<EFileChange, { mark: string; className: string }> = {
  [EFileChange.Added]: { mark: 'A', className: 'text-diff-add-foreground' },
  [EFileChange.Modified]: { mark: 'M', className: 'text-warning' },
  [EFileChange.Deleted]: { mark: 'D', className: 'text-diff-remove-foreground' },
}

export function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => total + (node.children ? countFiles(node.children) : 1), 0)
}

function FileTreeNode({ node, selected, onSelect, defaultOpen }: NodeProps) {
  if (node.children) {
    return (
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="sm" className="w-full justify-start font-mono text-xs" />
          }
        >
          <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90" />
          <FolderIcon />
          {node.name}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 flex flex-col border-l pl-1">
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                selected={selected}
                onSelect={onSelect}
                defaultOpen={defaultOpen}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  const change = node.change ? CHANGE_MARK[node.change] : undefined
  const handleSelect = () => onSelect?.(node.path)

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-current={selected === node.path ? 'true' : undefined}
      className={cn('w-full justify-start font-mono text-xs', selected === node.path && 'bg-muted')}
      onClick={handleSelect}
    >
      <FileIcon />
      <span className="truncate">{node.name}</span>
      {change ? (
        <span className={cn('ml-auto font-semibold', change.className)}>{change.mark}</span>
      ) : null}
    </Button>
  )
}

export function FileTree({ nodes, selected, onSelect, defaultOpen = true }: FileTreeProps) {
  return (
    <div className="flex flex-col">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          selected={selected}
          onSelect={onSelect}
          defaultOpen={defaultOpen}
        />
      ))}
    </div>
  )
}
