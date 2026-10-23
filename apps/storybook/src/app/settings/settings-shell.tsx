import { useState, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BugIcon,
  GitBranchIcon,
  MailIcon,
  SearchIcon,
} from 'lucide-react'

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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@dltech/atlas-ui/components/sidebar'

import { ESettingsPage, PERSONAL_NAV, filterNav } from './settings-nav'

const HELP_LINKS = [
  { label: 'Docs', icon: BookOpenIcon },
  { label: 'GitHub', icon: GitBranchIcon },
  { label: 'Report a bug', icon: BugIcon },
  { label: 'Email us', icon: MailIcon },
]

function SettingsTopBar() {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b px-3">
      <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground">
        <ArrowLeftIcon data-icon="inline-start" />
        Back to Atlas
      </Button>
      <span className="text-sm font-medium">Settings</span>
      <span />
    </header>
  )
}

function HelpCard() {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-background/40 p-1.5">
      {HELP_LINKS.map(({ label, icon: Icon }) => (
        <a
          key={label}
          href="#"
          className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Icon className="size-3.5" />
          {label}
        </a>
      ))}
    </div>
  )
}

function SettingsNav({
  page,
  onPageChange,
}: {
  page: ESettingsPage
  onPageChange: (page: ESettingsPage) => void
}) {
  const [query, setQuery] = useState('')
  const groups = filterNav({ groups: PERSONAL_NAV, query })
  return (
    <Sidebar collapsible="none" className="w-60 border-r">
      <SidebarHeader className="pt-3">
        <InputGroup className="h-8 bg-background">
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
      <SidebarContent className="gap-0">
        {groups.map((group, index) => (
          <SidebarGroup key={group.label ?? `group-${index}`} className="py-1">
            {group.label ? (
              <SidebarGroupLabel className="h-7">{group.label}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.page}>
                    <SidebarMenuButton
                      size="sm"
                      isActive={item.page === page}
                      onClick={() => onPageChange(item.page)}
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
      <SidebarFooter>
        <HelpCard />
      </SidebarFooter>
    </Sidebar>
  )
}

export function SettingsShell({
  initialPage,
  renderPage,
}: {
  initialPage: ESettingsPage
  renderPage: (page: ESettingsPage) => ReactNode
}) {
  const [page, setPage] = useState(initialPage)
  return (
    <SidebarProvider className="h-svh min-h-0 flex-col">
      <SettingsTopBar />
      <div className="flex min-h-0 flex-1">
        <SettingsNav page={page} onPageChange={setPage} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-8 py-10">{renderPage(page)}</div>
        </main>
      </div>
    </SidebarProvider>
  )
}
