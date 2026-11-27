import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import type { TPosture } from '../layout/posture'
import { AccountButton } from './account-button'
import { GlassSurface } from './glass-surface'
import { EHeaderLeadingItem, leadingTitleWidthOf, tabHeaderLeadingOf } from './header-leading'
import { NewSessionButton } from './new-session-button'

export const LEAD_GAP = 10

const BAR_PILL_HEIGHT = 44

export const TabHeaderTitle = ({ title }: { title: string }) => (
  <Text size={ETextRole.Base} weight={EFontWeight.Semibold} numberOfLines={1}>
    {title}
  </Text>
)

export const newSessionHeaderItemOf = (): NativeStackHeaderItem => ({
  type: 'button',
  label: 'New session',
  icon: { type: 'sfSymbol', name: 'plus' },
  accessibilityLabel: 'New session',
  onPress: () => router.push('/new'),
})

export const leadingHeaderOptionsOf = ({
  leading = [],
  lead,
  title,
  glassTitle = false,
  fillsBar = false,
  titleButtons,
  windowWidth,
  posture,
}: {
  leading?: NativeStackHeaderItem[]
  lead?: ReactNode
  title: ReactNode
  glassTitle?: boolean
  fillsBar?: boolean
  titleButtons: number
  windowWidth: number
  posture: TPosture
}): NativeStackNavigationOptions => {
  const iosLead = Platform.OS === 'ios' ? lead : undefined
  const titleWidth = leadingTitleWidthOf({ windowWidth, posture, buttons: titleButtons })
  const titleElement = (
    <View
      style={[
        styles.title,
        glassTitle ? styles.glassTitle : null,
        glassTitle && iosLead !== undefined ? styles.glassTitleWithLead : null,
        { maxWidth: titleWidth },
      ]}
    >
      {iosLead}
      <View style={styles.titleText}>{title}</View>
    </View>
  )
  if (fillsBar && Platform.OS === 'ios') {
    return {
      headerTitle: () => (
        <GlassSurface
          style={[
            styles.title,
            styles.glassTitle,
            styles.barPill,
            iosLead === undefined ? null : styles.glassTitleWithLead,
            { width: titleWidth },
          ]}
        >
          {iosLead}
          <View style={styles.fillText}>{title}</View>
        </GlassSurface>
      ),
      unstable_headerLeftItems: () => [...leading],
    }
  }
  return {
    headerTitle: Platform.OS === 'ios' ? '' : () => titleElement,
    unstable_headerLeftItems: () => [
      ...leading,
      {
        type: 'custom',
        element: titleElement,
        hidesSharedBackground: !glassTitle,
        visibilityPriority: 'high',
      },
    ],
  }
}

export const tabHeaderOptionsOf = ({
  title,
  posture,
  windowWidth,
}: {
  title: string
  posture: TPosture
  windowWidth: number
}): NativeStackNavigationOptions => {
  const leading = tabHeaderLeadingOf({ posture })
  const showsAccount = leading.includes(EHeaderLeadingItem.Account)
  return {
    title,
    ...leadingHeaderOptionsOf({
      lead: showsAccount ? <AccountButton /> : undefined,
      title: <TabHeaderTitle title={title} />,
      glassTitle: true,
      titleButtons: 2,
      windowWidth,
      posture,
    }),
    headerLeft: Platform.OS === 'ios' || !showsAccount ? undefined : () => <AccountButton />,
    headerRight: Platform.OS === 'ios' ? undefined : () => <NewSessionButton />,
    unstable_headerRightItems: Platform.OS === 'ios' ? () => [newSessionHeaderItemOf()] : undefined,
  }
}

const styles = StyleSheet.create({
  title: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: LEAD_GAP,
  },
  titleText: {
    flexShrink: 1,
  },
  glassTitle: {
    paddingHorizontal: 12,
  },
  glassTitleWithLead: {
    paddingLeft: 4,
  },
  barPill: {
    borderRadius: BAR_PILL_HEIGHT / 2,
    minHeight: BAR_PILL_HEIGHT,
    paddingVertical: 4,
  },
  fillText: {
    flex: 1,
  },
})
