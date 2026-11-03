import * as AppleAuthentication from 'expo-apple-authentication'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'
import { GlassSurface } from '../components/glass-surface'
import { useTheme } from '../theme/use-theme'

export default function SignInScreen() {
  const theme = useTheme()
  const { state, error, signIn, signInWithApple, appleSignInAvailable } = useAuth()
  const busy = state === EAuthState.SigningIn || state === EAuthState.Loading
  const showApple = Platform.OS === 'ios' && appleSignInAvailable

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <GlassSurface style={styles.card}>
        <Text style={[styles.wordmark, { color: theme.foreground }]}>Atlas</Text>
        <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
          Your sessions, everywhere
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void signIn()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary, opacity: busy || pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.primaryLabel, { color: theme.primaryForeground }]}>
            {busy ? 'Signing in…' : 'Continue with Atlas'}
          </Text>
        </Pressable>
        {showApple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={12}
            style={styles.appleButton}
            onPress={() => void signInWithApple()}
          />
        ) : null}
        {state === EAuthState.Failed && error !== undefined ? (
          <Text style={[styles.error, { color: theme.destructive }]}>{error}</Text>
        ) : null}
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    alignItems: 'center',
    gap: 16,
    maxWidth: 420,
    width: '100%',
  },
  wordmark: {
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    width: '100%',
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  appleButton: {
    height: 50,
    width: '100%',
  },
  error: {
    fontSize: 14,
    textAlign: 'center',
  },
})
