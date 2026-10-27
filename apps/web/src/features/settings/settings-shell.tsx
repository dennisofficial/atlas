'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { Sidebar, SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { PageStatusScope } from './status/page-status-scope'
import { SETTINGS_PAGE_STATUS } from './status/page-status'
import { SettingsMobileNav } from './settings-mobile-nav'
import { SettingsNavBody } from './settings-nav-body'
import { SettingsTopBar } from './settings-top-bar'
import {
  ESettingsPage,
  ESettingsScope,
  firstPageOf,
  hrefOfPage,
  scopeOfPage,
  settingsPageOfPath,
} from './settings-nav'

export function SettingsShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const page = settingsPageOfPath(usePathname()) ?? ESettingsPage.Account
  const scope = scopeOfPage(page)
  const handleScopeChange = (next: ESettingsScope) => router.push(hrefOfPage(firstPageOf(next)))
  return (
    <SidebarProvider className="h-svh min-h-0 flex-col">
      <SettingsTopBar scope={scope} onScopeChange={handleScopeChange} />
      <SettingsMobileNav scope={scope} page={page} />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsible="none" className="hidden w-60 md:flex">
          <SettingsNavBody scope={scope} page={page} />
        </Sidebar>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
            <PageStatusScope pageKey={page} {...SETTINGS_PAGE_STATUS[page]}>
              {children}
            </PageStatusScope>
          </div>
        </main>
      </div>
    </SidebarProvider>
  )
}
