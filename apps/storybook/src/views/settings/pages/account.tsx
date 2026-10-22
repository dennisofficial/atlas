import { SIGN_IN_METHODS_BOTH, type SignInMethods } from '../../../fixtures/settings-account'
import { AccountProfileCard } from '../parts/account-profile-card'
import { AccountSignInMethodsCard } from '../parts/account-sign-in-methods-card'
import { AccountWorkspacesCard } from '../parts/account-workspaces-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

export function AccountPage({
  signInMethods = SIGN_IN_METHODS_BOTH,
}: {
  signInMethods?: SignInMethods
}) {
  return (
    <SettingsPage title="Account" description="Your profile and the workspaces you belong to.">
      <SettingsSection title="Profile">
        <AccountProfileCard />
      </SettingsSection>
      <SettingsSection title="Sign-in methods" description="How you can sign in to Atlas.">
        <AccountSignInMethodsCard methods={signInMethods} />
      </SettingsSection>
      <SettingsSection title="Workspaces" description="Workspaces you are a member of.">
        <AccountWorkspacesCard />
      </SettingsSection>
    </SettingsPage>
  )
}
