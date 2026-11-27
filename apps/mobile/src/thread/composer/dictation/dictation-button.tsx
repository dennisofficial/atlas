import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { Mic, Square } from 'lucide-react-native'

import type { DictationButtonProps } from './dictation-button-props'

export const DictationButton = ({ recording, onPress }: DictationButtonProps) => (
  <Button
    label={recording ? 'Stop dictation' : 'Start dictation'}
    icon={recording ? Square : Mic}
    size={EButtonSize.IconSm}
    variant={recording ? EButtonVariant.Secondary : EButtonVariant.Outline}
    round
    onPress={onPress}
  />
)
