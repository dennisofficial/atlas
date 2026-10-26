import { FolderKanban, MessagesSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EAppNav } from './shell-types'

interface NavItem {
  nav: EAppNav
  label: string
  href: string
  Icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { nav: EAppNav.Threads, label: 'Threads', href: '/', Icon: MessagesSquare },
  { nav: EAppNav.Projects, label: 'Projects', href: '/projects', Icon: FolderKanban },
]

export function ShellBottomNav({ activeNav }: { activeNav: EAppNav }) {
  return (
    <nav
      aria-label="Primary"
      className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col"
    >
      {NAV_ITEMS.map(({ nav, label, href, Icon }) => (
        <Tooltip key={nav}>
          <TooltipTrigger
            render={
              <Link
                href={href}
                aria-label={label}
                aria-current={nav === activeNav ? 'page' : undefined}
                className={cn(
                  'flex h-7 flex-1 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:flex-none',
                  nav === activeNav && 'bg-sidebar-accent text-sidebar-accent-foreground',
                )}
              />
            }
          >
            <Icon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  )
}
