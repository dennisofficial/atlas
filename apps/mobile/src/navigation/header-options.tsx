import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { AccountButton } from './account-button'
import { leadingTitleWidthOf } from './header-leading'
import { NewSessionButton } from './new-session-button'

export const LEAD_GAP = 10

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
  titleButtons,
  windowWidth,
}: {
  leading?: NativeStackHeaderItem[]
  lead?: ReactNode
  title: ReactNode
  glassTitle?: boolean
  titleButtons: number
  windowWidth: number
}): NativeStackNavigationOptions => {
  const iosLead = Platform.OS === 'ios' ? lead : undefined
  const titleElement = (
    <View
      style={[
        styles.title,
        glassTitle ? styles.glassTitle : null,
        glassTitle && iosLead !== undefined ? styles.glassTitleWithLead : null,
        { maxWidth: leadingTitleWidthOf({ windowWidth, buttons: titleButtons }) },
      ]}
    >
      {iosLead}
      <View style={styles.titleText}>{title}</View>
    </View>
  )
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
  windowWidth,
}: {
  title: string
  windowWidth: number
}): NativeStackNavigationOptions => ({
  title,
  ...leadingHeaderOptionsOf({
    lead: <AccountButton />,
    title: <TabHeaderTitle title={title} />,
    glassTitle: true,
    titleButtons: 2,
    windowWidth,
  }),
  headerLeft: Platform.OS === 'ios' ? undefined : () => <AccountButton />,
  headerRight: Platform.OS === 'ios' ? undefined : () => <NewSessionButton />,
  unstable_headerRightItems: Platform.OS === 'ios' ? () => [newSessionHeaderItemOf()] : undefined,
})

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
})
