import {
  FolderGitIcon,
  HistoryIcon,
  SettingsIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  title: string
  icon: LucideIcon
  badge?: string
  children?: string[]
}

export const primaryNav: NavItem[] = [
  {
    title: 'Sessions',
    icon: SquareTerminalIcon,
    badge: '3',
    children: ['Running', 'Waiting for approval', 'Finished'],
  },
  { title: 'Repositories', icon: FolderGitIcon },
  { title: 'History', icon: HistoryIcon },
]

export const secondaryNav: NavItem[] = [
  { title: 'Tools', icon: WrenchIcon },
  { title: 'Settings', icon: SettingsIcon },
]

export const recentSessions = [
  'fix flaky ws reconnect',
  'add storybook coverage spec',
  'migrate web to shadcn',
  'trim sandbox image',
]
