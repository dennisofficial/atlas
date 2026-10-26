'use client'

import { CollapsibleTrigger } from './ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { ChevronRightIcon, FolderDotIcon, FolderIcon } from 'lucide-react'

import { EFolderKind, type FolderNode } from './page-tree'
import { cn } from './ui/utils'

const GROUP_TOOLTIP = 'Route group, not in the URL'

function FolderGlyph({ kind }: { kind: EFolderKind }) {
  if (kind !== EFolderKind.Group) return <FolderIcon className="size-3.5 shrink-0" />
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span data-testid="route-group-icon" className="flex shrink-0 items-center" />}
      >
        <FolderDotIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="right">{GROUP_TOOLTIP}</TooltipContent>
    </Tooltip>
  )
}

export function TreeFolderRow({ node, open }: { node: FolderNode; open: boolean }) {
  const isGroup = node.kind === EFolderKind.Group
  return (
    <CollapsibleTrigger
      data-kind={node.kind}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        isGroup ? 'text-muted-foreground' : 'text-sidebar-foreground',
      )}
    >
      <ChevronRightIcon
        className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-90',
        )}
      />
      <FolderGlyph kind={node.kind} />
      <span className={cn('truncate', node.kind === EFolderKind.Dynamic && 'proto-mono text-xs')}>
        {node.name}
      </span>
    </CollapsibleTrigger>
  )
}
