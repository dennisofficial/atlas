'use client'

import Link from 'next/link'
import { useState } from 'react'
import { SearchIcon } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import { Kbd } from '@dltech/atlas-ui/components/kbd'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@dltech/atlas-ui/components/sidebar'

import { ESettingsPage, ESettingsScope, filterNav, hrefOfPage, navForScope } from './settings-nav'

export function SettingsNavBody({
  scope,
  page,
  onNavigate,
}: {
  scope: ESettingsScope
  page: ESettingsPage
  onNavigate?: () => void
}) {
  const [query, setQuery] = useState('')
  const groups = filterNav({ groups: navForScope(scope), query })
  return (
    <>
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
            <Kbd className="hidden md:inline-flex">/</Kbd>
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
                      onClick={onNavigate}
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
    </>
  )
}
