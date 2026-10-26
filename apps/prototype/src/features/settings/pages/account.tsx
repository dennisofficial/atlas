import { SIGN_IN_METHODS_BOTH, type SignInMethods } from '../fixtures/settings-account'
import { AccountProfileCard } from '../parts/account-profile-card'
import { AccountSignInMethodsCard } from '../parts/account-sign-in-methods-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

export function AccountPage({
  signInMethods = SIGN_IN_METHODS_BOTH,
}: {
  signInMethods?: SignInMethods
}) {
  return (
    <SettingsPage title="Account" description="Your name, email, and the ways you sign in.">
      <SettingsSection title="Profile">
        <AccountProfileCard />
      </SettingsSection>
      <SettingsSection title="Sign-in methods">
        <AccountSignInMethodsCard methods={signInMethods} />
      </SettingsSection>
    </SettingsPage>
  )
}
