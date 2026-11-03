'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { Sidebar, SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { PageStatusScope } from './status/page-status-scope'
import { SETTINGS_PAGE_STATUS } from './status/page-status'
import { SettingsMobileNav } from './settings-mobile-nav'
import { SettingsNavBody } from './settings-nav-body'
import { SettingsTopBar } from './settings-top-bar'
import { ESettingsPage, settingsPageOfPath } from './settings-nav'

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const page = settingsPageOfPath(pathname) ?? ESettingsPage.Account
  const fullBleed = /^\/settings\/skills\/[^/]+$/.test(pathname)
  return (
    <SidebarProvider className="h-svh min-h-0 flex-col">
      <SettingsTopBar />
      <SettingsMobileNav page={page} />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsible="none" className="hidden w-60 md:flex">
          <SettingsNavBody page={page} />
        </Sidebar>
        <main
          className={
            fullBleed
              ? 'flex min-w-0 flex-1 flex-col overflow-hidden'
              : 'min-w-0 flex-1 overflow-y-auto'
          }
        >
          {fullBleed ? (
            children
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
              <PageStatusScope pageKey={page} {...SETTINGS_PAGE_STATUS[page]}>
                {children}
              </PageStatusScope>
            </div>
          )}
        </main>
      </div>
    </SidebarProvider>
  )
}
