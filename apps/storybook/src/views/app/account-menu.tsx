import {
  ArrowUpRight,
  BookOpen,
  Bug,
  Check,
  ChevronsUpDown,
  Command,
  HeartPulse,
  Keyboard,
  LogOut,
  Megaphone,
  Users,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@dltech/atlas-ui/components/kbd'
import { SidebarMenuButton } from '@dltech/atlas-ui/components/sidebar'

import { USER, WORKSPACE } from '../../fixtures/app'

export interface AccountMenuProps {
  defaultOpen?: boolean
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <KbdGroup className="ml-auto">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}

function External() {
  return <ArrowUpRight className="ml-auto text-muted-foreground" />
}

function WorkspaceTile() {
  return (
    <span className="flex size-4 items-center justify-center rounded-sm bg-primary font-display text-[10px] leading-none font-semibold text-primary-foreground">
      {WORKSPACE.initials}
    </span>
  )
}

function UserAvatar() {
  return (
    <span className="flex size-4 items-center justify-center rounded-full bg-muted font-sans text-[8px] leading-none text-muted-foreground">
      {USER.initials}
    </span>
  )
}

export function AccountMenu({ defaultOpen }: AccountMenuProps) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton className="h-10 gap-2 px-2 group-data-[collapsible=icon]:px-1!" />
        }
      >
        <Avatar size="sm">
          <AvatarFallback>{USER.initials}</AvatarFallback>
        </Avatar>
        <span className="flex-1 truncate">{USER.name}</span>
        <ChevronsUpDown className="ml-auto text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <LogOut />
            Sign out
          </DropdownMenuItem>
          <DropdownMenuItem>
            <HeartPulse />
            Status page
            <External />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <BookOpen />
            Docs
            <External />
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Megaphone />
            Changelog
            <External />
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Bug />
            Report a bug…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <Keyboard />
            Keymap
            <Keys keys={['?']} />
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Command />
            Command palette
            <Keys keys={['⌘', 'K']} />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Users />
              Switch account
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuItem>
                <UserAvatar />
                {USER.name}
                <Check className="ml-auto" />
              </DropdownMenuItem>
              <DropdownMenuItem>
                <WorkspaceTile />
                {WORKSPACE.name}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <WorkspaceTile />
            {WORKSPACE.name} settings
            <Keys keys={['⌥', '⌘', ',']} />
          </DropdownMenuItem>
          <DropdownMenuItem>
            <UserAvatar />
            Personal settings
            <Keys keys={['⌘', ',']} />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
