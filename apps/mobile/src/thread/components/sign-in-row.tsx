import { EReturnResult, stateOfStartLink } from '@dltech/atlas-core'
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

import { openBrowserReturn, useReturnOutcome } from '../../browser-return'
import type { SignInRow } from '../rows'
import { signInDurableOutcomeOf } from '../sign-in/outcome'

export type SignInAgainHandler = (server: string) => Promise<void>

const PendingSignIn = ({ row }: { row: SignInRow }) => {
  const theme = useTheme()
  const [opening, setOpening] = useState(false)

  const handleSignIn = () => {
    setOpening(true)
    void openBrowserReturn({ url: row.url }).finally(() => setOpening(false))
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

const FailedSignIn = ({
  row,
  reason,
  onSignInAgain,
}: {
  row: SignInRow
  reason: string | undefined
  onSignInAgain: SignInAgainHandler | undefined
}) => {
  const theme = useTheme()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = () => {
    if (onSignInAgain === undefined) return
    setRetrying(true)
    void onSignInAgain(row.subject).finally(() => setRetrying(false))
  }

  return (
    <Trace>
      <TraceLine
        icon={<Icon icon={CircleX} size={16} color={theme.destructive} />}
        title={`Could not sign in to ${row.subject}`}
        status={ETraceStatus.Error}
      />
      {reason === undefined ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} selectable style={styles.reason}>
          {reason}
        </Text>
      )}
      {onSignInAgain === undefined ? null : (
        <View style={styles.retry}>
          <Button
            label="Try again"
            size={EButtonSize.Sm}
            variant={EButtonVariant.Outline}
            loading={retrying}
            onPress={handleRetry}
          />
        </View>
      )}
    </Trace>
  )
}

export const SignInRowView = ({
  row,
  onSignInAgain,
}: {
  row: SignInRow
  onSignInAgain?: SignInAgainHandler | undefined
}) => {
  const theme = useTheme()
  const outcome = useReturnOutcome({
    state: stateOfStartLink(row.url) ?? '',
    durable: signInDurableOutcomeOf(row),
  })

  if (outcome?.result === EReturnResult.Connected)
    return (
      <Trace>
        <TraceLine
          icon={<Icon icon={CircleCheck} size={16} color={theme.mutedForeground} />}
          title={`Signed in to ${row.subject}`}
        />
      </Trace>
    )

  if (outcome?.result === EReturnResult.Failed)
    return <FailedSignIn row={row} reason={outcome.reason} onSignInAgain={onSignInAgain} />

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
  retry: {
    flexDirection: 'row',
    marginTop: space(1.5),
    paddingLeft: space(6),
  },
})
