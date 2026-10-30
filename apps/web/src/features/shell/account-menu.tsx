import { ChevronsUpDown, LogOut, Settings } from 'lucide-react'
import Link from 'next/link'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import { SidebarMenuButton } from '@dltech/atlas-ui/components/sidebar'

import { desktopSignOut } from '@/features/desktop/desktop-auth'
import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { useVersionLine } from '@/features/desktop/use-version-line'
import { signOut, type SessionUser } from '@/lib/auth-api'

const SIGN_IN_PATH = '/sign-in'

export function AccountMenu({ user, initials }: { user: SessionUser | null; initials: string }) {
  const version = useVersionLine()
  const handleSignOut = async () => {
    const leave = isDesktopHost(window) ? desktopSignOut : signOut
    await leave().catch(() => undefined)
    window.location.assign(SIGN_IN_PATH)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="avatar" />}>
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="flex-1 truncate">{user?.name ?? 'Account'}</span>
        <ChevronsUpDown className="ml-auto text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-60">
        {user === null ? null : (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {version === null ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel data-testid="account-menu-version" title={version}>
                <span className="block truncate font-normal tabular-nums select-text">
                  {version}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
