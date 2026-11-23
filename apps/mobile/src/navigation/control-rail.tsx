import { space } from '@dltech/atlas-ui/tokens'
import { usePathname } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { RAIL_MIN_INSET, RAIL_TOP_CLEARANCE } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import { AccountButton } from './account-button'
import { GlassSurface } from './glass-surface'
import { TabButton } from './tab-button'
import { activeTabOf, APP_TABS } from './tabs'

const CAPSULE_MAX_WIDTH = 56

export const railCapsuleWidth = (railWidth: number): number =>
  Math.min(CAPSULE_MAX_WIDTH, Math.max(RAIL_MIN_INSET, railWidth - space(1) * 2))

export const ControlRail = () => {
  const posture = usePosture()
  const active = activeTabOf(usePathname())
  const width = railCapsuleWidth(posture.railWidth)
  return (
    <View style={[styles.root, { width: posture.railWidth }]} pointerEvents="box-none">
      <GlassSurface style={[styles.capsule, { width, borderRadius: width / 2 }]}>
        <View style={styles.account}>
          <AccountButton />
        </View>
        <View style={styles.tabs}>
          {APP_TABS.map((item) => (
            <TabButton key={item.tab} item={item} active={item.tab === active} />
          ))}
        </View>
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    position: 'absolute',
    right: 0,
    top: RAIL_TOP_CLEARANCE,
  },
  capsule: {
    alignItems: 'center',
    gap: space(4),
    paddingVertical: space(2),
  },
  account: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
  },
  tabs: {
    alignItems: 'center',
    gap: space(1),
  },
})
