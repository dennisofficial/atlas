import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { Plus } from 'lucide-react-native'

import type { AttachButtonProps } from './attach-sources'

export const AttachButton = ({ open, onToggle }: AttachButtonProps) => (
  <Button
    label={open ? 'Close the attachment menu' : 'Attach a file'}
    icon={Plus}
    size={EButtonSize.IconSm}
    variant={EButtonVariant.Outline}
    round
    onPress={onToggle}
  />
)
