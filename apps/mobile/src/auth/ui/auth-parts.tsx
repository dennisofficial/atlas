import {
  AtlasMark,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Input,
  type IInputProps,
  Separator,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import * as WebBrowser from 'expo-web-browser'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { webOrigin } from '../../config'

export const AuthBrand = () => {
  const theme = useTheme()
  return (
    <View style={styles.brand}>
      <AtlasMark size={24} color={theme.primary} />
      <Text size={ETextRole.Lg} family={EFontFamily.Display} weight={EFontWeight.Semibold}>
        Atlas
      </Text>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
        Cloud
      </Text>
    </View>
  )
}

export const AuthHeading = ({ title, description }: { title: string; description: string }) => (
  <View style={styles.heading}>
    <Text
      size={ETextRole.Xxl}
      family={EFontFamily.Display}
      weight={EFontWeight.Semibold}
      tight
      style={styles.center}
    >
      {title}
    </Text>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={[styles.center, styles.relaxed]}>
      {description}
    </Text>
  </View>
)

export const OrDivider = () => (
  <View style={styles.divider}>
    <View style={styles.flex}>
      <Separator />
    </View>
    <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
      or
    </Text>
    <View style={styles.flex}>
      <Separator />
    </View>
  </View>
)

export const openWebPage = (path: string) => void WebBrowser.openBrowserAsync(`${webOrigin}${path}`)

export const AuthLink = ({ label, path }: { label: string; path: string }) => {
  const theme = useTheme()
  return (
    <Text
      size={ETextRole.Sm}
      weight={EFontWeight.Medium}
      color={theme.link}
      accessibilityRole="link"
      onPress={() => openWebPage(path)}
    >
      {label}
    </Text>
  )
}

export const AuthField = ({
  label,
  action,
  ...input
}: IInputProps & { label: string; action?: ReactNode }) => (
  <View style={styles.field}>
    <View style={styles.fieldLabel}>
      <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
        {label}
      </Text>
      {action}
    </View>
    <Input large accessibilityLabel={label} {...input} />
  </View>
)

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  heading: {
    gap: space(2),
  },
  center: {
    textAlign: 'center',
  },
  relaxed: {
    lineHeight: 22,
  },
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(3),
  },
  flex: {
    flex: 1,
  },
  field: {
    gap: space(2),
  },
  fieldLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})
