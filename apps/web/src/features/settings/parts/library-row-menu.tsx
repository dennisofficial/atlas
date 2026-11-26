'use client'

import { EllipsisIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

export type LibraryMenuAction = {
  label: string
  onSelect: () => void
  destructive?: boolean
}

export type LibraryMenuSubmenu = {
  label: string
  items: readonly LibraryMenuEntry[]
}

export type LibraryMenuEntry = LibraryMenuAction | LibraryMenuSubmenu

function LibraryMenuItem({ entry }: { entry: LibraryMenuEntry }) {
  if ('items' in entry) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{entry.label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-w-64">
          {entry.items.map((item) => (
            <LibraryMenuItem key={item.label} entry={item} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }
  return (
    <>
      {entry.destructive ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem
        variant={entry.destructive ? 'destructive' : 'default'}
        onClick={entry.onSelect}
      >
        <span className="truncate">{entry.label}</span>
      </DropdownMenuItem>
    </>
  )
}

export function LibraryRowMenu({
  label,
  actions,
}: {
  label: string
  actions: readonly LibraryMenuEntry[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`${label} actions`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {actions.map((entry) => (
          <LibraryMenuItem key={entry.label} entry={entry} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
