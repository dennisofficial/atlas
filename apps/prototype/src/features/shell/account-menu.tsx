import {
  ArrowUpRight,
  BookOpen,
  Bug,
  ChevronsUpDown,
  Command,
  HeartPulse,
  Keyboard,
  LogOut,
  Megaphone,
  Settings,
} from 'lucide-react'
import Link from 'next/link'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@dltech/atlas-ui/components/kbd'
import { SidebarMenuButton } from '@dltech/atlas-ui/components/sidebar'

import { USER } from './fixtures/app'

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
          <DropdownMenuItem render={<Link href="/sign-in" />}>
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
          <DropdownMenuItem render={<Link href="/settings/account" />}>
            <Settings />
            Settings
            <Keys keys={['⌘', ',']} />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
