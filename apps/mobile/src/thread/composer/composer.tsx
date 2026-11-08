import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { ArrowUp, Square } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

export const Composer = ({
  working,
  onSend,
  onStop,
}: {
  working: boolean
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
}) => {
  const theme = useTheme()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  const text = draft.trim()
  const canSend = text.length > 0 && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setFailed(false)
    const sent = await onSend(text)
    setSending(false)
    if (sent) setDraft('')
    else setFailed(true)
  }

  return (
    <View style={styles.dock}>
      {failed ? (
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.notice}>
          That message could not be sent.
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.card,
            borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
          },
        ]}
      >
        <Input
          bare
          multiline
          accessibilityLabel="Message Atlas"
          placeholder="Message Atlas…"
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
        />
        {working ? (
          <Button
            label="Stop"
            icon={Square}
            size={EButtonSize.IconSm}
            variant={EButtonVariant.Secondary}
            onPress={onStop}
          />
        ) : (
          <Button
            label="Send"
            icon={ArrowUp}
            size={EButtonSize.IconSm}
            disabled={!canSend}
            loading={sending}
            onPress={() => void handleSend()}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    paddingBottom: space(2),
    paddingHorizontal: space(3),
    paddingTop: space(2),
  },
  field: {
    alignItems: 'flex-end',
    borderRadius: radius(1.4),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(2),
    padding: space(2),
  },
  input: {
    flex: 1,
    maxHeight: 160,
    minHeight: 36,
    paddingHorizontal: space(1),
    paddingVertical: space(1),
  },
  notice: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
  },
})
