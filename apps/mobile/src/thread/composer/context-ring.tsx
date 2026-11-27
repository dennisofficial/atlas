import { StyleSheet, View } from 'react-native'

import { COMPOSER_TRIGGER_INSET } from './composer-shape'
import { type ContextRingProps, contextLabelOf } from './context-reading'
import { ContextRingGlyph } from './context-ring-glyph'

const TRIGGER_HEIGHT = 28

export const ContextRing = ({ context }: ContextRingProps) => (
  <View accessible accessibilityLabel={contextLabelOf(context)} style={styles.ring}>
    <ContextRingGlyph context={context} />
  </View>
)

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    height: TRIGGER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: COMPOSER_TRIGGER_INSET,
  },
})
