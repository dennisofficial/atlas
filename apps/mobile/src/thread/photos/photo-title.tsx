import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { GlassSurface } from '../../navigation/glass-surface'
import { PHOTO_ACTION_SIZE } from './photo-action-button'

export const PhotoTitle = ({ name }: { name: string }) => (
  <View pointerEvents="none" style={styles.slot}>
    <GlassSurface style={styles.pill}>
      <Text
        size={ETextRole.Sm}
        weight={EFontWeight.Medium}
        numberOfLines={1}
        ellipsizeMode="middle"
        accessibilityRole="header"
      >
        {name}
      </Text>
    </GlassSurface>
  </View>
)

const styles = StyleSheet.create({
  slot: {
    alignItems: 'flex-start',
    flex: 1,
    marginHorizontal: space(2),
  },
  pill: {
    borderRadius: PHOTO_ACTION_SIZE / 2,
    height: PHOTO_ACTION_SIZE,
    justifyContent: 'center',
    maxWidth: '100%',
    overflow: 'hidden',
    paddingHorizontal: space(4),
  },
})
