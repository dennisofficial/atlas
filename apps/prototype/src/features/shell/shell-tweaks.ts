import type { Control, Values } from '@/proto/use-prototype'

import type { ShellDemoState } from './shell-types'

export enum EShellHoverCard {
  None = 'none',
  Thread = 'thread',
  Project = 'project',
}

export enum EStatusStyle {
  Dot = 'icon-and-dot',
  Bold = 'icon-and-bold-title',
  Label = 'icon-and-label',
}

export const SHELL_CONTROLS = {
  statusStyle: {
    type: 'select',
    label: 'Status style',
    options: Object.values(EStatusStyle),
    default: EStatusStyle.Dot,
  },
  hoverCard: {
    type: 'select',
    label: 'Hover card',
    options: Object.values(EShellHoverCard),
    default: EShellHoverCard.None,
  },
  archived: { type: 'boolean', label: 'Archived open', default: false },
  accountMenu: { type: 'boolean', label: 'Account menu open', default: false },
  collapsed: { type: 'boolean', label: 'Sidebar collapsed', default: false },
} satisfies Record<string, Control>

export const HOME_PATH = '/'

export const THREAD_CARD_ID = 'thr-snapshots'
export const PROJECT_CARD_ID = 'rs-crm'
export const ARCHIVED_THREAD_ID = 'thr-wire-zod'

export function shellDemoOf(values: Values<typeof SHELL_CONTROLS>): ShellDemoState {
  return {
    ...(values.hoverCard === EShellHoverCard.Thread ? { threadCardId: THREAD_CARD_ID } : {}),
    ...(values.hoverCard === EShellHoverCard.Project ? { projectCardId: PROJECT_CARD_ID } : {}),
    ...(values.archived
      ? { archivedThreadIds: [ARCHIVED_THREAD_ID], archivedBucketOpen: true }
      : {}),
    ...(values.accountMenu ? { accountMenuOpen: true } : {}),
    ...(values.collapsed ? { collapsed: true } : {}),
  }
}
