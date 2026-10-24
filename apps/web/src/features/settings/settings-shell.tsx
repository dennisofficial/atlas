'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { ArrowLeftIcon, SearchIcon } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import { Kbd } from '@dltech/atlas-ui/components/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@dltech/atlas-ui/components/sidebar'
import { Tabs, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { PageStatusScope } from './status/page-status-scope'
import { SETTINGS_PAGE_STATUS } from './status/page-status'
import { initialsOf } from './session/initials'
import { useSessionUser, useWorkspaceName } from './session/use-session-identity'
import {
  ESettingsPage,
  ESettingsScope,
  filterNav,
  firstPageOf,
  hrefOfPage,
  navForScope,
  scopeOfPage,
} from './settings-nav'

export function WorkspaceLogo({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex size-4 items-center justify-center rounded-[4px] bg-primary text-[10px] font-semibold text-primary-foreground ${className ?? ''}`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function ScopeTabs({
  scope,
  onScopeChange,
}: {
  scope: ESettingsScope
  onScopeChange: (scope: ESettingsScope) => void
}) {
  const { user } = useSessionUser()
  const workspaceName = useWorkspaceName()
  const initials = initialsOf(user?.name ?? '')
  return (
    <Tabs value={scope} onValueChange={(value) => onScopeChange(value as ESettingsScope)}>
      <TabsList>
        <TabsTrigger value={ESettingsScope.Personal}>
          <Avatar size="xs">
            {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          Personal
        </TabsTrigger>
        <TabsTrigger value={ESettingsScope.Workspace}>
          <WorkspaceLogo name={workspaceName} />
          {workspaceName}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

function SettingsTopBar({
  scope,
  onScopeChange,
}: {
  scope: ESettingsScope
  onScopeChange: (scope: ESettingsScope) => void
}) {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b px-3">
      <Button
        variant="ghost"
        size="sm"
        className="justify-self-start text-muted-foreground"
        nativeButton={false}
        render={<Link href="/" />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Back to Atlas
      </Button>
      <ScopeTabs scope={scope} onScopeChange={onScopeChange} />
      <span />
    </header>
  )
}

function SettingsNav({ scope, page }: { scope: ESettingsScope; page: ESettingsPage }) {
  const [query, setQuery] = useState('')
  const groups = filterNav({ groups: navForScope(scope), query })
  return (
    <Sidebar collapsible="none" className="w-60">
      <SidebarHeader>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <Kbd>/</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group, index) => (
          <SidebarGroup key={group.label ?? `group-${index}`}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.page}>
                    <SidebarMenuButton
                      size="sm"
                      isActive={item.page === page}
                      render={<Link href={hrefOfPage(item.page)} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {groups.length === 0 ? (
          <p className="px-4 py-2 text-xs text-muted-foreground">No settings match “{query}”.</p>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}

export function SettingsShell({
  page,
  renderPage,
}: {
  page: ESettingsPage
  renderPage: (page: ESettingsPage) => ReactNode
}) {
  const router = useRouter()
  const scope = scopeOfPage(page)
  const handleScopeChange = (next: ESettingsScope) => router.push(hrefOfPage(firstPageOf(next)))
  return (
    <SidebarProvider className="h-svh min-h-0 flex-col">
      <SettingsTopBar scope={scope} onScopeChange={handleScopeChange} />
      <div className="flex min-h-0 flex-1">
        <SettingsNav scope={scope} page={page} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-8 py-10">
            <PageStatusScope pageKey={page} {...SETTINGS_PAGE_STATUS[page]}>
              {renderPage(page)}
            </PageStatusScope>
          </div>
        </main>
      </div>
    </SidebarProvider>
  )
}
