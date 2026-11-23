'use client'

import { ENotifyDeviceKind } from '@dltech/atlas-core'
import type { NotifyDeviceView } from '@dltech/atlas-wire/web'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { useState } from 'react'

import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { listNotifyDevices, setNotifyDeviceEnabled } from '../../sessions/data/notify-api'
import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'

const TITLE = 'Devices'
const DESCRIPTION = 'Where Atlas reaches you when no Atlas window is in front of you.'

const KIND_LABEL: Record<ENotifyDeviceKind, string> = {
  [ENotifyDeviceKind.WebPush]: 'Web',
  [ENotifyDeviceKind.Expo]: 'iPhone',
  [ENotifyDeviceKind.ApnsMac]: 'Mac',
}

const EMPTY_DEVICES: readonly NotifyDeviceView[] = []

export function NotifyDevicesCard() {
  const query = useCloudQuery({ key: 'notify-devices', load: listNotifyDevices })
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({})

  const devices = query.state === EQueryState.Ready ? query.data.devices : EMPTY_DEVICES

  const handleToggle = async (params: { deviceId: string; enabled: boolean }) => {
    setOverrides((current) => ({ ...current, [params.deviceId]: params.enabled }))
    try {
      await setNotifyDeviceEnabled({ deviceId: params.deviceId, enabled: params.enabled })
    } catch {
      setOverrides((current) => ({ ...current, [params.deviceId]: !params.enabled }))
    }
  }

  return (
    <SettingsSection title={TITLE} description={DESCRIPTION}>
      <SettingsCard>
        {devices.length === 0 ? (
          <SettingsRow
            title={query.state === EQueryState.Loading ? 'Loading devices…' : 'No devices yet'}
            description="Turn notifications on in the app or the browser and the device appears here."
          />
        ) : (
          devices.map((device) => {
            const enabled = overrides[device.id] ?? device.enabled
            return (
              <SettingsRow
                key={device.id}
                title={device.label}
                description={`${KIND_LABEL[device.kind]} · ${enabled ? 'On' : 'Off'}`}
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(next) =>
                      void handleToggle({ deviceId: device.id, enabled: next })
                    }
                    aria-label={`${device.label} notifications`}
                  />
                }
              />
            )
          })
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
