'use client'

import { EllipsisIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

export type LibraryMenuAction = {
  label: string
  onSelect: () => void
  destructive?: boolean
}

export function LibraryRowMenu({
  label,
  actions,
}: {
  label: string
  actions: LibraryMenuAction[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`${label} actions`} />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {actions.map((action) => (
          <span key={action.label} className="contents">
            {action.destructive ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={action.destructive ? 'destructive' : 'default'}
              onClick={action.onSelect}
            >
              {action.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
