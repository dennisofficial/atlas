import {
  CardList,
  CardRow,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <View style={styles.section}>
    <Text size={ETextRole.Sm} weight={EFontWeight.Medium} style={styles.sectionTitle}>
      {title}
    </Text>
    <CardList>{children}</CardList>
  </View>
)

export const Row = ({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) => (
  <CardRow>
    <Text size={ETextRole.Sm}>{label}</Text>
    <Text
      size={ETextRole.Sm}
      tone={ETextTone.Muted}
      family={mono ? EFontFamily.Mono : EFontFamily.Sans}
      numberOfLines={1}
      style={styles.value}
    >
      {value}
    </Text>
  </CardRow>
)

const styles = StyleSheet.create({
  section: {
    gap: space(2),
  },
  sectionTitle: {
    paddingHorizontal: space(1),
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
})
