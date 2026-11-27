import { space } from '@dltech/atlas-ui/tokens'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  ETraceStatus,
  Icon,
  Text,
  Trace,
  TraceLine,
  useTheme,
} from '@dltech/atlas-ui-native'
import { CircleCheck, CircleX, LogIn } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import type { SignInRow } from '../rows'
import { openSignIn } from '../sign-in/open-sign-in'

const PendingSignIn = ({ row }: { row: SignInRow }) => {
  const theme = useTheme()
  const [opening, setOpening] = useState(false)

  const handleSignIn = () => {
    setOpening(true)
    void openSignIn(row.url).finally(() => setOpening(false))
  }

  return (
    <View style={styles.pending}>
      <View style={styles.title}>
        <TraceLine
          icon={<Icon icon={LogIn} size={16} color={theme.mutedForeground} />}
          title={`${row.subject} needs a sign-in`}
        />
      </View>
      <Button
        label="Sign in"
        size={EButtonSize.Sm}
        variant={EButtonVariant.Outline}
        loading={opening}
        onPress={handleSignIn}
      />
    </View>
  )
}

export const SignInRowView = ({ row }: { row: SignInRow }) => {
  const theme = useTheme()
  if (row.result === 'connected')
    return (
      <Trace>
        <TraceLine
          icon={<Icon icon={CircleCheck} size={16} color={theme.mutedForeground} />}
          title={`Signed in to ${row.subject}`}
        />
      </Trace>
    )

  if (row.result === 'failed')
    return (
      <Trace>
        <TraceLine
          icon={<Icon icon={CircleX} size={16} color={theme.destructive} />}
          title={`Could not sign in to ${row.subject}`}
          status={ETraceStatus.Error}
        />
        {row.reason === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} selectable style={styles.reason}>
            {row.reason}
          </Text>
        )}
      </Trace>
    )

  return (
    <Trace>
      <PendingSignIn row={row} />
    </Trace>
  )
}

const styles = StyleSheet.create({
  pending: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  title: {
    flexShrink: 1,
  },
  reason: {
    paddingLeft: space(6),
  },
})
