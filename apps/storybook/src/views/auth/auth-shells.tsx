import type { ReactNode } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { CENTERED_PANEL } from './auth-align'
import { AuthBrand } from './auth-brand'
import { deviceCodeOf } from './auth-flow-steps'
import type { AuthRoute } from './auth-route'
import { AuthTerminal } from './auth-terminal'

export interface ShellProps {
  route: AuthRoute
  children: ReactNode
}

export function AuthShell({ route, children }: ShellProps) {
  const code = deviceCodeOf(route) ?? undefined
  return (
    <div className="grid min-h-screen bg-background md:grid-cols-2">
      <aside className="hidden flex-col justify-between gap-12 border-r bg-card p-12 md:flex">
        <AuthBrand />
        <div className="flex max-w-md flex-col gap-8">
          <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight text-balance text-foreground">
            Start an agent in the cloud. Finish it from your terminal.
          </h2>
          <AuthTerminal code={code} />
        </div>
        <p className="text-xs text-muted-foreground">Atlas Cloud</p>
      </aside>
      <main className="flex flex-col items-center px-4 py-10 md:justify-center md:px-12">
        <div
          {...CENTERED_PANEL}
          className={cn(CENTERED_PANEL.className, 'flex w-full max-w-sm flex-col gap-10 md:gap-0')}
        >
          <header className="flex justify-center md:hidden">
            <AuthBrand />
          </header>
          {children}
        </div>
      </main>
    </div>
  )
}
