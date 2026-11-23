import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { CircleAlert } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

export const StartFailedCard = ({
  reason,
  onRetry,
}: {
  reason: string | undefined
  onRetry: () => Promise<void>
}) => {
  const theme = useTheme()
  const [pending, setPending] = useState(false)

  const handleRetry = async () => {
    if (pending) return
    setPending(true)
    try {
      await onRetry()
    } finally {
      setPending(false)
    }
  }

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel="Start failed"
      style={[
        styles.card,
        {
          backgroundColor: withAlpha({ color: theme.destructive, alpha: 0.1 }),
          borderColor: withAlpha({ color: theme.destructive, alpha: 0.3 }),
        },
      ]}
    >
      <Icon icon={CircleAlert} size={16} color={theme.destructive} />
      <View style={styles.body}>
        <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
          Atlas couldn't start this session
        </Text>
        {reason === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            {reason}
          </Text>
        )}
      </View>
      <Button
        label="Retry"
        size={EButtonSize.Sm}
        variant={EButtonVariant.Outline}
        loading={pending}
        disabled={pending}
        onPress={() => void handleRetry()}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'flex-start',
    borderRadius: radius(1.4),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(2),
    marginBottom: space(2),
    marginHorizontal: space(3),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  body: {
    flex: 1,
    gap: space(0.5),
  },
})
