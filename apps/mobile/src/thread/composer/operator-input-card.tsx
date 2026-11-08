import {
  Button,
  EButtonSize,
  EFontWeight,
  ETextRole,
  ETextTone,
  Input,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import type { OperatorInputRequestWire } from '@dltech/atlas-wire/web'
import { Linking, StyleSheet, View } from 'react-native'
import { useState } from 'react'

export const OPERATOR_INPUT_TITLE = 'Atlas needs you'
const PRIVACY = 'The model never sees what you paste.'

export const OperatorInputCard = ({
  request,
  onSubmit,
}: {
  request: OperatorInputRequestWire
  onSubmit: (value: string) => Promise<string | null>
}) => {
  const theme = useTheme()
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const canSubmit = value.length > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    const failure = await onSubmit(value)
    setSubmitting(false)
    if (failure !== null) {
      setNotice(failure)
      return
    }
    setValue('')
    setNotice(null)
  }

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={OPERATOR_INPUT_TITLE}
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
          {OPERATOR_INPUT_TITLE}
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {request.description}
        </Text>
        {request.url === undefined ? null : (
          <Text
            size={ETextRole.Xs}
            tone={ETextTone.Primary}
            numberOfLines={1}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(request.url ?? '')}
          >
            {request.url}
          </Text>
        )}
      </View>
      <Input
        multiline
        accessibilityLabel="Paste here"
        placeholder="Paste here"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        spellCheck={false}
        value={value}
        onChangeText={setValue}
        style={styles.input}
      />
      {notice === null ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive}>
          {notice}
        </Text>
      )}
      <View style={styles.footer}>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.privacy}>
          {PRIVACY}
        </Text>
        <Button
          label="Send"
          size={EButtonSize.Sm}
          disabled={!canSubmit}
          loading={submitting}
          onPress={() => void handleSubmit()}
        />
      </View>
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
  input: {
    maxHeight: 120,
    minHeight: 64,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  privacy: {
    flex: 1,
  },
})
