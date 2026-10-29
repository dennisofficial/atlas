'use client'

import { usePathname } from 'next/navigation'
import { Suspense, type CSSProperties, type ReactNode } from 'react'

import { SidebarInset, SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'

import { activeNavOf, activeThreadIdOf } from './active-route'
import { AppSidebar } from './app-sidebar'
import { AtlasMark } from './atlas-mark'
import { CloseSidebarOnNavigate } from './close-sidebar-on-navigate'
import { RememberReturnPath } from './remember-return-path'
import { EShellBar, shellBarOf } from './shell-bar'
import { ShellMobileBar } from './shell-mobile-bar'

const SIDEBAR_STYLE = { '--sidebar-width': '18rem' } as CSSProperties

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
        <CloseSidebarOnNavigate />
        <Suspense fallback={null}>
          <RememberReturnPath />
        </Suspense>
        <AppSidebar activeThreadId={activeThreadIdOf(pathname)} activeNav={activeNavOf(pathname)} />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          {shellBarOf(pathname) === EShellBar.Global ? <ShellMobileBar /> : null}
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
