'use client'

import { useEffect, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { installClientId } from '@/lib/client-id'
import { currentSubscriptionEndpoint, enableWebPush } from '@/lib/web-push'
import {
  notificationsWebPushKey,
  registerNotifyDevice,
  sendTestNotification,
} from '../../sessions/data/notify-api'
import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'

type DeviceState = 'checking' | 'off' | 'on' | 'unsupported' | 'denied' | 'failed'

const TITLE = 'This device'
const DESCRIPTION = 'Get an OS notification here when no Atlas window is in front of you.'

const STATE_TEXT: Record<DeviceState, string> = {
  checking: 'Checking this browser…',
  off: 'Notifications are off for this browser.',
  on: 'Notifications are on for this browser.',
  unsupported: 'This browser cannot receive notifications.',
  denied: 'The browser blocked notifications. Allow them in the browser settings.',
  failed: 'Notifications could not be turned on. Try again.',
}

export function ThisDeviceNotifications() {
  const [state, setState] = useState<DeviceState>('checking')
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const key = await notificationsWebPushKey()
      const endpoint = await currentSubscriptionEndpoint()
      if (!live) return
      setPublicKey(key.publicKey)
      setState(endpoint === null ? 'off' : 'on')
    })()
    return () => {
      live = false
    }
  }, [])

  const handleEnable = async () => {
    if (publicKey === null) return
    setBusy(true)
    try {
      const result = await enableWebPush({
        clientId: installClientId(),
        publicKey,
      })
      if (result.state !== 'subscribed') {
        setState(result.state === 'denied' ? 'denied' : 'unsupported')
        return
      }
      await registerNotifyDevice(result.input)
      setState('on')
    } catch {
      setState('failed')
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      await sendTestNotification()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title={TITLE} description={DESCRIPTION}>
      <SettingsCard>
        <SettingsRow
          title={state === 'on' ? 'On' : 'Turn on notifications'}
          description={STATE_TEXT[state]}
          control={
            <div className="flex flex-wrap items-center gap-2">
              {state === 'off' ? (
                <Button size="sm" disabled={busy || publicKey === null} onClick={handleEnable}>
                  Turn on notifications
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || state !== 'on'}
                onClick={handleTest}
              >
                Send a test notification
              </Button>
            </div>
          }
        />
      </SettingsCard>
    </SettingsSection>
  )
}
