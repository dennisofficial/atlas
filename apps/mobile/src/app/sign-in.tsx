import {
  AtlasMark,
  Button,
  Card,
  EButtonSize,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
  useIsDark,
  useTheme,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import * as AppleAuthentication from 'expo-apple-authentication'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'

export default function SignInScreen() {
  const theme = useTheme()
  const dark = useIsDark()
  const { state, error, signIn, signInWithApple, appleSignInAvailable } = useAuth()
  const busy = state === EAuthState.SigningIn || state === EAuthState.Loading
  const showApple = Platform.OS === 'ios' && appleSignInAvailable

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Card style={styles.card}>
        <View style={styles.brand}>
          <AtlasMark size={40} color={theme.primary} />
          <Text
            size={ETextRole.Display}
            family={EFontFamily.Display}
            weight={EFontWeight.Semibold}
            tight
          >
            Atlas
          </Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Your sessions, everywhere
          </Text>
        </View>
        <Button
          label={busy ? 'Signing in…' : 'Continue with Atlas'}
          size={EButtonSize.Lg}
          stretch
          disabled={busy}
          onPress={() => void signIn()}
        />
        {showApple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              dark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={radius(1)}
            style={styles.appleButton}
            onPress={() => void signInWithApple()}
          />
        ) : null}
        {state === EAuthState.Failed && error !== undefined ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.error}>
            {error}
          </Text>
        ) : null}
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: space(6),
  },
  card: {
    gap: space(3),
    maxWidth: 380,
    padding: space(6),
    width: '100%',
  },
  brand: {
    alignItems: 'center',
    gap: space(2),
    paddingBottom: space(3),
  },
  appleButton: {
    height: 36,
    width: '100%',
  },
  error: {
    textAlign: 'center',
  },
})
