import { radius, space } from '@dltech/atlas-ui/tokens'
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
import { KeyRound } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import type { PendingOperatorAnswer } from '../session/operator-answer-view'
import type { OperatorRequestControl } from '../session/use-operator-request'
import { OperatorAnswerSheet } from './operator-answer-sheet'

const OperatorRequestCard = ({
  request,
  sending,
  onOpen,
}: {
  request: PendingOperatorAnswer
  sending: boolean
  onOpen: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLabel="Atlas needs you"
      onPress={onOpen}
      style={[
        styles.card,
        {
          backgroundColor: withAlpha({ color: theme.primary, alpha: 0.1 }),
          borderColor: withAlpha({ color: theme.primary, alpha: 0.3 }),
        },
      ]}
    >
      <Icon icon={KeyRound} size={16} color={theme.primary} />
      <View style={styles.body}>
        <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
          Atlas needs you
        </Text>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={3}>
          {request.prompt}
        </Text>
      </View>
      <Button
        label={sending ? 'Sending…' : 'Answer'}
        size={EButtonSize.Sm}
        variant={EButtonVariant.Default}
        disabled={sending}
        onPress={onOpen}
      />
    </Pressable>
  )
}

export const OperatorRequestDock = ({ operator }: { operator: OperatorRequestControl }) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ callId: string; text: string } | null>(null)
  const request = operator.request
  const callId = request?.callId
  const text = draft !== null && draft.callId === callId ? draft.text : ''

  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => setOpen(false), [])

  const handleChange = useCallback(
    (value: string) => {
      if (callId === undefined) return
      setDraft({ callId, text: value })
    },
    [callId],
  )

  const handleSend = useCallback(() => {
    if (text.trim().length === 0) return
    operator.handleAnswer(text)
    setOpen(false)
  }, [operator, text])

  const handleDecline = useCallback(() => {
    operator.handleDecline()
    setOpen(false)
  }, [operator])

  if (request === null) return null

  return (
    <>
      <OperatorRequestCard request={request} sending={operator.sending} onOpen={handleOpen} />
      <OperatorAnswerSheet
        open={open}
        prompt={request.prompt}
        value={text}
        sending={operator.sending}
        error={operator.error}
        onChange={handleChange}
        onClose={handleClose}
        onSend={handleSend}
        onDecline={handleDecline}
      />
    </>
  )
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
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
