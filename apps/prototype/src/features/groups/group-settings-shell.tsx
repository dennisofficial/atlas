import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { GroupFixture } from './fixtures/groups'
import { EGroupSettingsSection, GROUP_NAV, hrefOfGroupSection } from './group-settings-nav'

export function GroupSettingsShell({
  groupId,
  group,
  active,
  children,
}: {
  groupId: string
  group: GroupFixture
  active: EGroupSettingsSection
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 grid h-12 grid-cols-[1fr_auto_1fr] items-center border-b bg-background px-3">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings/groups" />}
          className="justify-self-start text-muted-foreground"
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to groups
        </Button>
        <p className="truncate text-sm font-medium">
          Group Settings
          <span className="text-muted-foreground"> — </span>
          <span className="font-mono text-muted-foreground">{group.name}</span>
        </p>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 md:flex-row md:gap-10">
        <nav aria-label="Group settings" className="shrink-0 md:w-44">
          <ul className="flex gap-0.5 overflow-x-auto md:sticky md:top-20 md:flex-col">
            {GROUP_NAV.map((item) => {
              const current = item.section === active
              const Icon = item.icon
              return (
                <li key={item.section}>
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    aria-current={current ? 'page' : undefined}
                    render={<Link href={hrefOfGroupSection({ groupId, section: item.section })} />}
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
