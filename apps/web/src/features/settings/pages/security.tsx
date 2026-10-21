'use client'

import { useCallback, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Button } from '@dltech/atlas-ui/components/button'

import { useCloudQuery } from '@/lib/use-cloud-query'

import {
  fetchCurrentSession,
  fetchSessions,
  revokeOtherSessions,
  revokeSession,
  toDevice,
} from '../data/personal/auth-session-api'
import { QuerySection } from '../data/personal/query-boundary'
import { useSaveAction } from '../data/personal/use-save-action'
import type { SignedInDevice } from '../fixtures/settings-security'
import { ActivityTable } from '../parts/security-activity-table'
import { DeviceRow } from '../parts/security-device-row'
import { PendingCodeRow } from '../parts/security-pending-code'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

async function loadDevices(): Promise<SignedInDevice[]> {
  const [sessions, current] = await Promise.all([fetchSessions(), fetchCurrentSession()])
  const currentToken = current.session?.token ?? null
  return sessions
    .map((session) => toDevice({ session, currentToken }))
    .sort((left, right) => Number(right.current) - Number(left.current))
}

export function SecurityPage() {
  const devicesQuery = useCloudQuery({ key: 'security-sessions', load: loadDevices })
  const { reload } = devicesQuery
  const { saving, run } = useSaveAction()
  const [pendingOpen, setPendingOpen] = useState(true)

  const handleRevoke = useCallback(
    (token: string) =>
      void run({
        work: async () => {
          await revokeSession(token)
          reload()
        },
        success: 'Session revoked',
      }),
    [run, reload],
  )
  const handleRevokeOthers = useCallback(
    () =>
      void run({
        work: async () => {
          await revokeOtherSessions()
          reload()
        },
        success: 'Signed out of other devices',
      }),
    [run, reload],
  )
  const handleResolvePending = () => setPendingOpen(false)

  return (
    <SettingsPage
      title="Security"
      description="Devices signed in to your account and recent sign-in activity."
      actions={
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={saving} />}>
            Sign out of all other devices
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of all other devices?</AlertDialogTitle>
              <AlertDialogDescription>
                Every browser, CLI, TUI, and sandbox session except this one is revoked. Each will
                need to sign in again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => handleRevokeOthers()}>
                Sign out others
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    >
      <SettingsSection
        title="Signed-in devices"
        description="Browsers, terminals, and sandboxes holding a session for your account."
      >
        <QuerySection query={devicesQuery} title="Signed-in devices">
          {(devices) => (
            <SettingsCard>
              {devices.map((device) => (
                <DeviceRow key={device.id} device={device} onRevoke={handleRevoke} />
              ))}
            </SettingsCard>
          )}
        </QuerySection>
      </SettingsSection>
      {pendingOpen ? (
        <SettingsSection
          title="Pending device codes"
          description="A CLI or TUI is waiting for you to approve its sign-in."
        >
          <SettingsCard>
            <PendingCodeRow onApprove={handleResolvePending} onDeny={handleResolvePending} />
          </SettingsCard>
        </SettingsSection>
      ) : null}
      <SettingsSection
        title="Recent sign-in activity"
        description="The last 30 days of authentication events."
      >
        <SettingsCard>
          <ActivityTable />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
