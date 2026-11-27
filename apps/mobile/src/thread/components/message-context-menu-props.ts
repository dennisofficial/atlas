import type { ReactElement } from 'react'

import type { EMessageAction } from '../message-actions'

export type MessageContextMenuProps = {
  actions: readonly EMessageAction[]
  onAction: (action: EMessageAction) => void
  align?: 'start' | 'end'
  children: ReactElement
}
