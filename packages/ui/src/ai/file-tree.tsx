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
  ignored?: boolean
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

const CHANGE_MARK: Record<EFileChange, { mark: string; label: string; tint: string }> = {
  [EFileChange.Added]: { mark: 'A', label: 'added', tint: 'text-diff-add-foreground' },
  [EFileChange.Modified]: { mark: 'M', label: 'modified', tint: 'text-warning' },
  [EFileChange.Deleted]: { mark: 'D', label: 'deleted', tint: 'text-diff-remove-foreground' },
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
          <span className={nameClassOf(node)}>{node.name}</span>
          {node.change ? <ChangeMark change={node.change} folder /> : null}
          {node.ignored && node.change === undefined ? <IgnoredMark /> : null}
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

  const handleSelect = () => onSelect?.(node.path)

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-current={selected === node.path ? 'true' : undefined}
      className="w-full justify-start font-mono text-xs"
      onClick={handleSelect}
    >
      <FileIcon />
      <span className={nameClassOf(node)}>{node.name}</span>
      {node.change ? <ChangeMark change={node.change} folder={false} /> : null}
      {node.ignored && node.change === undefined ? <IgnoredMark /> : null}
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
