import { space } from '@dltech/atlas-ui/tokens'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import {
  COMPOSER_DOCK_BOTTOM,
  COMPOSER_FOOTER_GAP,
  COMPOSER_FOOTER_HEIGHT,
  COMPOSER_INSET,
} from './composer-shape'

export const ComposerFooter = ({ children }: { children: ReactNode }) => (
  <View pointerEvents="box-none" style={styles.footer}>
    {children}
  </View>
)

const styles = StyleSheet.create({
  footer: {
    bottom: COMPOSER_DOCK_BOTTOM - COMPOSER_FOOTER_GAP - COMPOSER_FOOTER_HEIGHT,
    height: COMPOSER_FOOTER_HEIGHT,
    justifyContent: 'center',
    position: 'absolute',
    right: space(4) + COMPOSER_INSET,
  },
})
