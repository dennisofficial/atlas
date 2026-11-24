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
  hidesSharedBackground: true,
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
  titleButtons,
  windowWidth,
  posture,
}: {
  leading?: NativeStackHeaderItem[]
  title: ReactNode
  titleButtons: number
  windowWidth: number
  posture: TPosture
}): NativeStackNavigationOptions => {
  const titleElement = (
    <View
      style={[
        styles.title,
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
      { type: 'custom', element: titleElement, hidesSharedBackground: true },
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
})
