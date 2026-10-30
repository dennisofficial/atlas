import { useCallback, useState } from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from '@dltech/atlas-ui/components/sidebar'

import { initialsOf } from '@/features/settings/session/initials'
import { useSessionUser } from '@/features/settings/session/use-session-identity'
import { EQueryState } from '@/lib/use-cloud-query'

import { AccountMenu } from './account-menu'
import { SearchPalette } from './search-palette'
import { ShellBottomNav } from './shell-bottom-nav'
import { ShellSidebarContent } from './shell-sidebar-content'
import { ShellTopBar } from './shell-top-bar'
import type { EAppNav } from './shell-types'
import { useOpenSearchRequests } from './search-events'
import { useSearchHotkey } from './use-search-hotkey'
import { useShellEntries } from './use-shell-entries'

export interface AppSidebarProps {
  activeThreadId: string | null
  activeNav: EAppNav
}

export function AppSidebar({ activeThreadId, activeNav }: AppSidebarProps) {
  const query = useShellEntries(activeThreadId)
  const { user } = useSessionUser()
  const [searchOpen, setSearchOpen] = useState(false)
  const initials = user === null ? '?' : initialsOf(user.name)

  const handleToggleSearch = useCallback(() => setSearchOpen((open) => !open), [])
  const handleOpenSearch = useCallback(() => setSearchOpen(true), [])
  useSearchHotkey(handleToggleSearch)
  useOpenSearchRequests(handleOpenSearch)

  return (
    <>
      <Sidebar collapsible="icon">
        <ShellTopBar onSearch={handleOpenSearch} />
        <SidebarContent className="group-data-[collapsible=icon]:hidden">
          <ShellSidebarContent query={query} activeThreadId={activeThreadId} />
        </SidebarContent>
        <SidebarFooter variant="bordered" className="group-data-[collapsible=icon]:mt-auto">
          <ShellBottomNav activeNav={activeNav} />
          <SidebarMenu>
            <SidebarMenuItem>
              <AccountMenu user={user} initials={initials} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        entries={query.state === EQueryState.Ready ? query.data : []}
      />
    </>
  )
}
