import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, Switch, View } from 'react-native'

export const SwitchRow = ({
  label,
  detail,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string
  detail?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
}) => (
  <CardRow>
    <View style={styles.copy}>
      <Text size={ETextRole.Sm}>{label}</Text>
      {detail === undefined ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {detail}
        </Text>
      )}
    </View>
    <Switch
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    />
  </CardRow>
)

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
})
