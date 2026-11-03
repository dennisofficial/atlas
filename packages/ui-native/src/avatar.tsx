import { ETextRole } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { ETextTone } from './text-style'
import { Text } from './text'
import { useTheme } from './use-theme'

export enum EAvatarSize {
  Sm = 'sm',
  Default = 'default',
  Lg = 'lg',
}

const DIAMETER = { [EAvatarSize.Sm]: 24, [EAvatarSize.Default]: 32, [EAvatarSize.Lg]: 40 }

export const Avatar = ({
  initials,
  size = EAvatarSize.Default,
}: {
  initials: string
  size?: EAvatarSize
}) => {
  const theme = useTheme()
  const diameter = DIAMETER[size]
  return (
    <View
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.muted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.border,
      }}
    >
      <Text size={size === EAvatarSize.Sm ? ETextRole.Xs : ETextRole.Sm} tone={ETextTone.Muted}>
        {initials}
      </Text>
    </View>
  )
}
