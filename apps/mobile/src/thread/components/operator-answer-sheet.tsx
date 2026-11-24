import { radius, space } from '@dltech/atlas-ui/tokens'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  ETextTone,
  Input,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const OperatorAnswerSheet = ({
  open,
  prompt,
  value,
  sending,
  error,
  onChange,
  onClose,
  onSend,
  onDecline,
}: {
  open: boolean
  prompt: string
  value: string
  sending: boolean
  error: string | undefined
  onChange: (value: string) => void
  onClose: () => void
  onSend: () => void
  onDecline: () => void
}) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const canSend = value.trim().length > 0 && !sending

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}
      >
        <View style={styles.bar}>
          <View style={styles.side}>
            <Button
              label="Cancel"
              size={EButtonSize.Sm}
              variant={EButtonVariant.Ghost}
              onPress={onClose}
            />
          </View>
          <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
            Atlas needs you
          </Text>
          <View style={[styles.side, styles.sideEnd]}>
            <Button
              label="Send"
              size={EButtonSize.Sm}
              variant={EButtonVariant.Default}
              loading={sending}
              disabled={!canSend}
              onPress={onSend}
            />
          </View>
        </View>
        <Text size={ETextRole.Sm} selectable>
          {prompt}
        </Text>
        <View style={[styles.field, { borderColor: theme.input }]}>
          <Input
            bare
            multiline
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="The answer"
            placeholder="Paste or type the answer"
            value={value}
            onChangeText={onChange}
            style={styles.input}
          />
        </View>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {sending ? 'Waiting for the session to confirm.' : 'The model never sees what you type.'}
        </Text>
        {error === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Destructive}>
            {error}
          </Text>
        )}
        <Button
          label="Decline request"
          size={EButtonSize.Sm}
          variant={EButtonVariant.Destructive}
          onPress={onDecline}
        />
      </ScrollView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    alignSelf: 'center',
    gap: space(3),
    maxWidth: 560,
    width: '100%',
    paddingHorizontal: space(4),
    paddingTop: space(4),
  },
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  side: {
    flex: 1,
    flexDirection: 'row',
  },
  sideEnd: {
    justifyContent: 'flex-end',
  },
  field: {
    borderRadius: radius(1),
    borderWidth: 1,
    paddingHorizontal: space(2.5),
    paddingTop: space(2.5),
  },
  input: {
    fontFamily: 'Geist_400Regular',
    minHeight: 96,
    paddingBottom: space(2),
  },
})
