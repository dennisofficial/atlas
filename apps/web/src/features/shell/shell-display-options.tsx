'use client'

import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

import { ESidebarDensity, useSidebarDensity } from './shell-density'

export function ShellDisplayOptions() {
  const { density, setDensity } = useSidebarDensity()
  const handleDensityChange = (value: unknown) => {
    if (value === ESidebarDensity.Comfortable || value === ESidebarDensity.Compact) {
      setDensity(value)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sidebar view options"
        render={<Button variant="ghost" size="icon-sm" className="shrink-0" />}
      >
        <SlidersHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Thread density</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={density} onValueChange={handleDensityChange}>
            <DropdownMenuRadioItem value={ESidebarDensity.Comfortable}>
              Comfortable
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value={ESidebarDensity.Compact}>Compact</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
