import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import type { NativeStackHeaderItem, NativeStackNavigationOptions } from 'expo-router'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import type { TPosture } from '../layout/posture'
import { AccountButton } from './account-button'
import { EHeaderLeadingItem, leadingTitleWidthOf, tabHeaderLeadingOf } from './header-leading'
import { NewSessionButton } from './new-session-button'

export const TabHeaderTitle = ({ title }: { title: string }) => (
  <Text size={ETextRole.Base} weight={EFontWeight.Semibold} numberOfLines={1}>
    {title}
  </Text>
)

const accountHeaderItemOf = (): NativeStackHeaderItem => ({
  type: 'custom',
  element: <AccountButton />,
  hidesSharedBackground: false,
})

const newSessionHeaderItemOf = (): NativeStackHeaderItem => ({
  type: 'button',
  label: 'New session',
  icon: { type: 'sfSymbol', name: 'plus' },
  accessibilityLabel: 'New session',
  onPress: () => router.push('/new'),
})

export const leadingHeaderOptionsOf = ({
  leading = [],
  title,
  glassTitle = false,
  titleButtons,
  windowWidth,
  posture,
}: {
  leading?: NativeStackHeaderItem[]
  title: ReactNode
  glassTitle?: boolean
  titleButtons: number
  windowWidth: number
  posture: TPosture
}): NativeStackNavigationOptions => {
  const titleElement = (
    <View
      style={[
        styles.title,
        glassTitle ? styles.glassTitle : null,
        { maxWidth: leadingTitleWidthOf({ windowWidth, posture, buttons: titleButtons }) },
      ]}
    >
      {title}
    </View>
  )
  return {
    headerTitle: Platform.OS === 'ios' ? '' : () => titleElement,
    unstable_headerLeftItems: () => [
      ...leading,
      { type: 'custom', element: titleElement, hidesSharedBackground: !glassTitle },
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
      leading: showsAccount ? [accountHeaderItemOf()] : [],
      title: <TabHeaderTitle title={title} />,
      glassTitle: true,
      titleButtons: leading.length + 1,
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
    flexShrink: 1,
  },
  glassTitle: {
    paddingHorizontal: 12,
  },
})
