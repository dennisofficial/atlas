import { MessageAction, MessageActions } from '@dltech/atlas-ui-native'
import { Check, Copy, History, type LucideIcon, ListCollapse } from 'lucide-react-native'

import { EMessageAction, messageActionLabelOf } from '../message-actions'

const iconOf = ({ action, copied }: { action: EMessageAction; copied: boolean }): LucideIcon => {
  if (action === EMessageAction.Copy) return copied ? Check : Copy
  if (action === EMessageAction.Rewind) return History
  return ListCollapse
}

const labelOf = ({ action, copied }: { action: EMessageAction; copied: boolean }): string => {
  if (action === EMessageAction.Copy && copied) return 'Copied'
  return messageActionLabelOf(action)
}

export const MessageActionsBar = ({
  actions,
  copied,
  onAction,
}: {
  actions: readonly EMessageAction[]
  copied: boolean
  onAction: (action: EMessageAction) => void
}) => (
  <MessageActions>
    {actions.map((action) => (
      <MessageAction
        key={action}
        icon={iconOf({ action, copied })}
        label={labelOf({ action, copied })}
        onPress={() => onAction(action)}
      />
    ))}
  </MessageActions>
)
