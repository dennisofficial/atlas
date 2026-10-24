'use client'

import { usePathname } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'

import { SidebarInset, SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'

import { activeNavOf, activeThreadIdOf } from './active-route'
import { AppSidebar } from './app-sidebar'
import { AtlasMark } from './atlas-mark'

const SIDEBAR_STYLE = { '--sidebar-width': '14rem' } as CSSProperties

export function EmptyHome() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <AtlasMark className="size-64 text-foreground opacity-5" />
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0" style={SIDEBAR_STYLE}>
        <AppSidebar activeThreadId={activeThreadIdOf(pathname)} activeNav={activeNavOf(pathname)} />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
