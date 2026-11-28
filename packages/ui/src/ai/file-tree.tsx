'use client'

import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'
import { cn } from '#lib/utils'
import { FileTypeIcon } from './file-type-icon'
import { TreeGuide } from './internal/tree-guide'

export enum EFileChange {
  Added = 'added',
  Modified = 'modified',
  Deleted = 'deleted',
}

export interface FileNode {
  path: string
  name: string
  children?: FileNode[]
  loaded?: boolean
  change?: EFileChange
  ignored?: boolean
}

export interface FileTreeProps {
  nodes: FileNode[]
  selected?: string
  onSelect?: (path: string) => void
  defaultOpen?: boolean
  open?: string[]
  onOpenChange?: (args: { path: string; open: boolean }) => void
}

interface NodeProps {
  node: FileNode
  selected?: string
  onSelect?: (path: string) => void
  defaultOpen: boolean
  open?: string[]
  onOpenChange?: (args: { path: string; open: boolean }) => void
}

const CHANGE_MARK: Record<EFileChange, { mark: string; label: string; tint: string }> = {
  [EFileChange.Added]: {
    mark: 'A',
    label: 'added',
    tint: 'text-diff-add-foreground',
  },
  [EFileChange.Modified]: {
    mark: 'M',
    label: 'modified',
    tint: 'text-warning',
  },
  [EFileChange.Deleted]: {
    mark: 'D',
    label: 'deleted',
    tint: 'text-diff-remove-foreground',
  },
}

export function nameClassOf(node: Pick<FileNode, 'change' | 'ignored' | 'children'>): string {
  if (node.change !== undefined) {
    const deletedFile = node.change === EFileChange.Deleted && node.children === undefined
    return cn('truncate', CHANGE_MARK[node.change].tint, deletedFile && 'line-through')
  }
  return cn('truncate', node.ignored === true && 'text-muted-foreground')
}

export function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => total + (node.children ? countFiles(node.children) : 1), 0)
}

function ChangeMark({ change, folder }: { change: EFileChange; folder: boolean }) {
  const { mark, label, tint } = CHANGE_MARK[change]
  return (
    <span className={cn('ml-auto font-semibold', tint)}>
      {folder ? (
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-current align-middle" />
      ) : (
        <span aria-hidden>{mark}</span>
      )}
      <span className="sr-only">{folder ? `, holds ${label} files` : `, ${label}`}</span>
    </span>
  )
}

function IgnoredMark() {
  return <span className="sr-only">, ignored by git</span>
}

function LoadingRow() {
  return (
    <div role="status" className="px-2.5 py-1 font-mono text-xs text-muted-foreground">
      Loading…
    </div>
  )
}

export function openPropsOf(args: {
  path: string
  open: string[] | undefined
  defaultOpen: boolean
  onOpenChange: NodeProps['onOpenChange']
}) {
  const { path, open, onOpenChange } = args
  if (open === undefined) {
    return {
      defaultOpen: args.defaultOpen,
      onOpenChange: (next: boolean) => onOpenChange?.({ path, open: next }),
    }
  }
  return {
    open: open.includes(path),
    onOpenChange: (next: boolean) => onOpenChange?.({ path, open: next }),
  }
}

function FileTreeNode({ node, selected, onSelect, defaultOpen, open, onOpenChange }: NodeProps) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  if (node.children) {
    const isOpen = open?.includes(node.path) ?? localOpen
    const props = openPropsOf({ path: node.path, open, defaultOpen, onOpenChange })
    const handleOpenChange = (next: boolean) => {
      setLocalOpen(next)
      props.onOpenChange(next)
    }
    return (
      <Collapsible {...props} onOpenChange={handleOpenChange}>
        <CollapsibleTrigger
          render={
            <Button variant="tree" size="sm" className="w-full justify-start font-mono text-xs" />
          }
        >
          <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90" />
          <FileTypeIcon name={node.name} folder open={isOpen} />
          <span className={nameClassOf(node)}>{node.name}</span>
          {node.change ? <ChangeMark change={node.change} folder /> : null}
          {node.ignored && node.change === undefined ? <IgnoredMark /> : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <TreeGuide>
            {node.loaded === false && isOpen ? <LoadingRow /> : null}
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                selected={selected}
                onSelect={onSelect}
                defaultOpen={defaultOpen}
                open={open}
                onOpenChange={onOpenChange}
              />
            ))}
          </TreeGuide>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  const handleSelect = () => onSelect?.(node.path)

  return (
    <Button
      variant="tree"
      size="sm"
      aria-current={selected === node.path ? 'true' : undefined}
      className="w-full justify-start font-mono text-xs"
      onClick={handleSelect}
    >
      <FileTypeIcon name={node.name} />
      <span className={nameClassOf(node)}>{node.name}</span>
      {node.change ? <ChangeMark change={node.change} folder={false} /> : null}
      {node.ignored && node.change === undefined ? <IgnoredMark /> : null}
    </Button>
  )
}

export function FileTree({
  nodes,
  selected,
  onSelect,
  defaultOpen = true,
  open,
  onOpenChange,
}: FileTreeProps) {
  return (
    <div className="flex flex-col">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          selected={selected}
          onSelect={onSelect}
          defaultOpen={defaultOpen}
          open={open}
          onOpenChange={onOpenChange}
        />
      ))}
    </div>
  )
}
