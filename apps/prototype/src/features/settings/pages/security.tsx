'use client'

import { useState } from 'react'

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

import { SIGNED_IN_DEVICES } from '../fixtures/settings-security'
import { DeviceRow } from '../parts/security-device-row'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

export function SecurityPage() {
  const [devices, setDevices] = useState(SIGNED_IN_DEVICES)

  const handleRevoke = (id: string) => setDevices((all) => all.filter((device) => device.id !== id))
  const handleRevokeOthers = () => setDevices((all) => all.filter((device) => device.current))

  return (
    <SettingsPage
      title="Security"
      description="Devices signed in to your account."
      actions={
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
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
              <AlertDialogAction variant="destructive" onClick={handleRevokeOthers}>
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
        <SettingsCard>
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} onRevoke={handleRevoke} />
          ))}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
