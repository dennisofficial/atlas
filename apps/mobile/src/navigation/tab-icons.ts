import type { LucideIcon } from 'lucide-react-native'
import { AppWindow, CalendarClock, FolderKanban, MessagesSquare } from 'lucide-react-native'

import { EAppTab } from './tabs'

export const TAB_ICONS: Record<EAppTab, LucideIcon> = {
  [EAppTab.Threads]: MessagesSquare,
  [EAppTab.Routines]: CalendarClock,
  [EAppTab.Projects]: FolderKanban,
  [EAppTab.Artifacts]: AppWindow,
}
