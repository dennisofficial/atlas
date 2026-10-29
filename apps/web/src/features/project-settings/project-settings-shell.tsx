'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { PageStatusScope, PageStatusSlot } from '../settings/status/page-status-scope'
import { PROJECT_SECTION_STATUS } from '../settings/status/page-status'
import { EProjectSettingsSection, PROJECT_NAV, hrefOfProjectSection } from './project-settings-nav'

export function ProjectSettingsShell({
  projectId,
  active,
  title,
  bare = false,
  children,
}: {
  projectId: string
  active: EProjectSettingsSection
  title: string
  bare?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 grid h-12 grid-cols-[auto_1fr] items-center gap-2 border-b bg-background px-3 md:grid-cols-[1fr_auto_1fr]">
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start text-muted-foreground"
          nativeButton={false}
          render={<Link href="/threads" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          <span className="sr-only sm:not-sr-only">Back to Atlas</span>
        </Button>
        <h1 className="min-w-0 truncate text-sm font-medium">
          Project Settings
          {title === '' ? null : (
            <>
              <span className="text-muted-foreground"> — </span>
              <span className="font-mono text-muted-foreground">{title}</span>
            </>
          )}
        </h1>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-10 md:px-6 md:py-8">
        <nav aria-label="Project settings" className="shrink-0 md:w-44">
          <ul className="flex gap-0.5 overflow-x-auto pb-1 md:sticky md:top-20 md:flex-col">
            {PROJECT_NAV.map((item) => {
              const current = item.section === active
              const Icon = item.icon
              return (
                <li key={item.section} className="shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    aria-current={current ? 'page' : undefined}
                    className={cn('w-full justify-start', !current && 'text-muted-foreground')}
                    render={
                      <Link href={hrefOfProjectSection({ projectId, section: item.section })} />
                    }
                  >
                    <Icon data-icon="inline-start" />
                    {item.label}
                  </Button>
                </li>
              )
            })}
          </ul>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col gap-10 pb-16">
          {bare ? (
            children
          ) : (
            <PageStatusScope pageKey={`project:${active}`} {...PROJECT_SECTION_STATUS[active]}>
              <PageStatusSlot />
              {children}
            </PageStatusScope>
          )}
        </main>
      </div>
    </div>
  )
}
