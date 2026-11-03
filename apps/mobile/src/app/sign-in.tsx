import {
  Alert,
  Button,
  EAlertTone,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
  useIsDark,
  useTheme,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import * as AppleAuthentication from 'expo-apple-authentication'
import { AlertCircle } from 'lucide-react-native'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuth } from '../auth/auth-provider'
import { EAuthState } from '../auth/auth-reducer'
import { AuthBrand, AuthField, AuthHeading, AuthLink, OrDivider } from '../auth/ui/auth-parts'
import { GoogleLogo } from '../auth/ui/google-logo'

export default function SignInScreen() {
  const theme = useTheme()
  const dark = useIsDark()
  const insets = useSafeAreaInsets()
  const { state, error, signIn, signInWithApple, signInWithEmail, appleSignInAvailable } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const busy = state === EAuthState.SigningIn || state === EAuthState.Loading
  const showApple = Platform.OS === 'ios' && appleSignInAvailable
  const canSubmit = !busy && email.trim().length > 0 && password.length > 0

  const handleSubmit = () => {
    if (!canSubmit) return
    void signInWithEmail({ email: email.trim(), password })
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space(10), paddingBottom: insets.bottom + space(10) },
        ]}
      >
        <View style={styles.panel}>
          <AuthBrand />
          <View style={styles.form}>
            <AuthHeading
              title="Sign in to Atlas"
              description="Use the account you use in the terminal."
            />
            <View style={styles.controls}>
              {state === EAuthState.Failed && error !== undefined ? (
                <Alert icon={AlertCircle} tone={EAlertTone.Destructive}>
                  {error}
                </Alert>
              ) : null}
              {showApple ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={
                    dark
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={radius(1)}
                  style={styles.apple}
                  onPress={() => void signInWithApple()}
                />
              ) : null}
              <Button
                label="Continue with Google"
                variant={EButtonVariant.Outline}
                size={EButtonSize.Lg}
                leading={<GoogleLogo size={16} />}
                stretch
                disabled={busy}
                onPress={() => void signIn()}
              />
              <OrDivider />
              <View style={styles.fields}>
                <AuthField
                  label="Email"
                  placeholder="you@company.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!busy}
                  value={email}
                  onChangeText={setEmail}
                />
                <AuthField
                  label="Password"
                  action={<AuthLink path="/forgot-password" label="Forgot password?" />}
                  autoComplete="current-password"
                  secureTextEntry
                  textContentType="password"
                  returnKeyType="go"
                  editable={!busy}
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={handleSubmit}
                />
                <Button
                  label="Sign in"
                  size={EButtonSize.Lg}
                  stretch
                  loading={busy}
                  onPress={handleSubmit}
                />
              </View>
            </View>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.footer}>
              No account? <AuthLink path="/sign-up" label="Sign up" />
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    alignItems: 'center',
    flexGrow: 1,
    paddingHorizontal: space(4),
  },
  panel: {
    gap: space(10),
    maxWidth: 384,
    width: '100%',
  },
  form: {
    gap: space(6),
  },
  controls: {
    gap: space(4),
  },
  apple: {
    height: 36,
    width: '100%',
  },
  fields: {
    gap: space(5),
  },
  footer: {
    textAlign: 'center',
  },
})
