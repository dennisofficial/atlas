'use client'

import { useState } from 'react'
import {
  ChevronRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
} from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@dltech/atlas-ui/components/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { SkillTreeNode } from './skill-tree'

export type TreeAction = { kind: 'new-file' | 'new-folder' | 'rename' | 'delete'; path: string }

function TreeRowActions({
  node,
  onAction,
}: {
  node: SkillTreeNode
  onAction: (action: TreeAction) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${node.name} actions`}
            className="invisible size-5 group-hover/row:visible"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-40">
        {node.folder ? (
          <>
            <DropdownMenuItem onClick={() => onAction({ kind: 'new-file', path: node.path })}>
              New file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction({ kind: 'new-folder', path: node.path })}>
              New folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={() => onAction({ kind: 'rename', path: node.path })}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onAction({ kind: 'delete', path: node.path })}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TreeNode({
  node,
  depth,
  selected,
  editable,
  onSelect,
  onAction,
}: {
  node: SkillTreeNode
  depth: number
  selected: string
  editable: boolean
  onSelect: (path: string) => void
  onAction: (action: TreeAction) => void
}) {
  const [open, setOpen] = useState(true)
  const isSelected = selected === node.path
  const indent = { paddingLeft: `${depth * 12 + 8}px` }

  if (node.folder) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className="group/row flex h-7 items-center gap-1 rounded-md pr-1 text-sm text-muted-foreground hover:bg-muted/60"
          style={indent}
        >
          <CollapsibleTrigger
            render={
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 outline-none"
              />
            }
          >
            <ChevronRightIcon
              className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
            />
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="truncate">{node.name}</span>
          </CollapsibleTrigger>
          {editable ? <TreeRowActions node={node} onAction={onAction} /> : null}
        </div>
        <CollapsibleContent>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              editable={editable}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <div
      className={cn(
        'group/row flex h-7 items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted/60',
        isSelected ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
      )}
      style={indent}
    >
      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => onSelect(node.path)}
        className="flex min-w-0 flex-1 items-center gap-1 outline-none"
      >
        <span className="size-3.5 shrink-0" />
        <FileIcon className="size-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
      {editable ? <TreeRowActions node={node} onAction={onAction} /> : null}
    </div>
  )
}

export function SkillFileTree({
  nodes,
  selected,
  editable,
  onSelect,
  onAction,
}: {
  nodes: SkillTreeNode[]
  selected: string
  editable: boolean
  onSelect: (path: string) => void
  onAction: (action: TreeAction) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {editable ? (
        <div className="mb-1 flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onAction({ kind: 'new-file', path: '' })}
          >
            <FilePlusIcon data-icon="inline-start" />
            File
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onAction({ kind: 'new-folder', path: '' })}
          >
            <FolderPlusIcon data-icon="inline-start" />
            Folder
          </Button>
        </div>
      ) : null}
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          selected={selected}
          editable={editable}
          onSelect={onSelect}
          onAction={onAction}
        />
      ))}
    </div>
  )
}
