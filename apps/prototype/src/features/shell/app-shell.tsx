'use client'

import { usePathname } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'

import { SidebarInset, SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'

import { activeNavOf, activeThreadIdOf } from './active-route'
import { AppSidebar } from './app-sidebar'
import { AtlasMark } from './atlas-mark'
import { PendingThreadProvider, usePendingThread } from './pending-thread'
import { useShellDemo } from './use-shell-demo'

const SIDEBAR_STYLE = { '--sidebar-width': '18rem' } as CSSProperties

export function EmptyHome() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <AtlasMark className="size-64 text-foreground opacity-5" />
    </div>
  )
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const demo = useShellDemo(pathname)
  const pendingThread = usePendingThread()
  const activeThreadId = activeThreadIdOf(pathname) ?? pendingThread?.id

  return (
    <TooltipProvider>
      <SidebarProvider
        key={JSON.stringify(demo)}
        defaultOpen={demo.collapsed !== true}
        className="h-svh min-h-0"
        style={SIDEBAR_STYLE}
      >
        <AppSidebar
          activeThreadId={activeThreadId}
          activeNav={activeNavOf(pathname)}
          demo={demo}
          pendingThread={pendingThread}
        />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PendingThreadProvider>
      <ShellFrame>{children}</ShellFrame>
    </PendingThreadProvider>
  )
}
