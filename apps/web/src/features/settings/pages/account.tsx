'use client'

import { Suspense, useCallback } from 'react'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { fetchAccountData, type AccountData } from '../data/personal/account-data'
import { updateName } from '../data/personal/auth-session-api'
import { QueryPage } from '../data/personal/query-boundary'
import { useSaveAction } from '../data/personal/use-save-action'
import { useSignInMethodActions } from '../data/personal/use-sign-in-method-actions'
import { AccountLinkReturn } from '../parts/account-link-return'
import { AccountProfileCard } from '../parts/account-profile-card'
import { AccountSignInMethodsCard } from '../parts/account-sign-in-methods-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Account'
const DESCRIPTION = 'Your profile and how you sign in.'

export function AccountPage() {
  const query = useCloudQuery({ key: 'personal-account', load: fetchAccountData })
  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION}>
      {(data) => <AccountContent data={data} reload={query.reload} />}
    </QueryPage>
  )
}

function AccountContent({ data, reload }: { data: AccountData; reload: () => void }) {
  const { saving, run } = useSaveAction()
  const handleSaveName = useCallback(
    async (name: string) => {
      const saved = await run({ work: () => updateName(name), success: 'Profile updated' })
      if (saved) reload()
      return saved
    },
    [run, reload],
  )
  const signInActions = useSignInMethodActions({
    email: data.email,
    methods: data.signInMethods,
    reload,
  })
  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <Suspense>
        <AccountLinkReturn reload={reload} />
      </Suspense>
      <SettingsSection title="Profile">
        <AccountProfileCard
          profile={{ name: data.name, email: data.email }}
          githubLogin={data.githubLogin}
          memberSince={data.memberSince}
          saving={saving}
          onSave={handleSaveName}
        />
      </SettingsSection>
      <SettingsSection title="Sign-in methods" description="How you can sign in to Atlas.">
        <AccountSignInMethodsCard methods={data.signInMethods} handlers={signInActions} />
      </SettingsSection>
    </SettingsPage>
  )
}
