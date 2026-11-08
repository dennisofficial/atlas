import {
  Button,
  EButtonSize,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'

import { expoUpdatesClient } from '../data/expo-updates-client'
import { STALE_TITLE, type UpdatesClient } from '../data/update-check'
import { useUpdateCheck } from '../data/use-update-check'

export const StaleCard = ({ client = expoUpdatesClient }: { client?: UpdatesClient }) => {
  const theme = useTheme()
  const update = useUpdateCheck({ client })

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={STALE_TITLE}
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
        },
      ]}
    >
      <View style={styles.header}>
        <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
          {STALE_TITLE}
        </Text>
        {update.detail === null ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            {update.detail}
          </Text>
        )}
      </View>
      <Button
        label={update.actionLabel}
        size={EButtonSize.Sm}
        loading={update.checking}
        onPress={update.act}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius(1.4),
    borderWidth: 1,
    gap: space(2.5),
    padding: space(3),
  },
  header: {
    gap: space(1),
  },
})
