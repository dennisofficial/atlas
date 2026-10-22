import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@dltech/atlas-ui/components/sidebar'

import { primaryNav, recentSessions, secondaryNav } from './sidebar.fixtures'

const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['sidebar', 'floating', 'inset'] },
    collapsible: { control: 'inline-radio', options: ['offcanvas', 'icon', 'none'] },
    side: { control: 'inline-radio', options: ['left', 'right'] },
  },
  args: { variant: 'sidebar', collapsible: 'icon', side: 'left' },
} satisfies Meta<typeof Sidebar>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <SidebarProvider className="h-[36rem] min-h-0">
      <Sidebar {...args} className="absolute">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Atlas">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary font-display text-sm font-semibold text-sidebar-primary-foreground">
                  A
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">Atlas</span>
                  <span className="text-xs text-muted-foreground">dennisofficial</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {primaryNav.map((item, index) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton isActive={index === 0} tooltip={item.title}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                    {item.children && (
                      <SidebarMenuSub>
                        {item.children.map((child) => (
                          <SidebarMenuSubItem key={child}>
                            <SidebarMenuSubButton render={<a href="#" />}>
                              <span>{child}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentSessions.map((session) => (
                  <SidebarMenuItem key={session}>
                    <SidebarMenuButton size="sm">
                      <span className="truncate">{session}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            {secondaryNav.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton tooltip={item.title}>
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b border-border px-3">
          <SidebarTrigger />
          <span className="text-sm font-medium">Sessions</span>
        </header>
        <div className="p-4 text-sm text-muted-foreground">
          Select a session to see its transcript.
        </div>
      </SidebarInset>
    </SidebarProvider>
  ),
}

export const Loading: Story = {
  render: (args) => (
    <SidebarProvider className="h-80 min-h-0">
      <Sidebar {...args} collapsible="none" className="h-full border-r border-border">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {Array.from({ length: 5 }, (_, index) => (
                  <SidebarMenuItem key={index}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  ),
}
