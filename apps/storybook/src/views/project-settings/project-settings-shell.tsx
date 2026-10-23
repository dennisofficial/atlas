import type { ReactNode } from 'react'
import {
  ArrowLeftIcon,
  BoxIcon,
  LayoutDashboardIcon,
  PlugIcon,
  VariableIcon,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EProjectSettingsPage, PROJECT } from '../../fixtures/project-settings'

const NAV_ITEMS: readonly { page: EProjectSettingsPage; label: string; icon: LucideIcon }[] = [
  { page: EProjectSettingsPage.Overview, label: 'Overview', icon: LayoutDashboardIcon },
  { page: EProjectSettingsPage.Sandbox, label: 'Sandbox', icon: BoxIcon },
  { page: EProjectSettingsPage.Secrets, label: 'Secrets & Env Vars', icon: VariableIcon },
  { page: EProjectSettingsPage.Mcp, label: 'MCP', icon: PlugIcon },
]

export function ProjectSettingsShell({
  active,
  children,
}: {
  active: EProjectSettingsPage
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 grid h-12 grid-cols-[1fr_auto_1fr] items-center border-b bg-background px-3">
        <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground">
          <ArrowLeftIcon data-icon="inline-start" />
          Back to Atlas
        </Button>
        <p className="truncate text-sm font-medium">
          Project Settings
          <span className="text-muted-foreground"> — </span>
          <span className="font-mono text-muted-foreground">
            {PROJECT.owner}/{PROJECT.name}
          </span>
        </p>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 md:flex-row md:gap-10">
        <nav aria-label="Project settings" className="shrink-0 md:w-44">
          <ul className="flex gap-0.5 overflow-x-auto md:sticky md:top-20 md:flex-col">
            {NAV_ITEMS.map((item) => {
              const current = item.page === active
              const Icon = item.icon
              return (
                <li key={item.page}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'w-full justify-start',
                      current ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </Button>
                </li>
              )
            })}
          </ul>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col gap-10 pb-16">{children}</main>
      </div>
    </div>
  )
}
