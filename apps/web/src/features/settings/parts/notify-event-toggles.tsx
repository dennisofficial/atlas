'use client'

import { Switch } from '@dltech/atlas-ui/components/switch'

import {
  NOTIFY_MOMENTS,
  type NotifyEventToggles as NotifyEventTogglesValue,
  type NotifyMomentId,
} from '../fixtures/settings-interface'
import { SettingsRow } from '../settings-layout'

export function NotifyEventToggles({
  value,
  onToggle,
}: {
  value: NotifyEventTogglesValue
  onToggle: (params: { moment: NotifyMomentId; enabled: boolean }) => void
}) {
  return (
    <>
      {NOTIFY_MOMENTS.map((moment) => (
        <SettingsRow
          key={moment.id}
          title={moment.title}
          description={moment.description}
          control={
            <Switch
              checked={value[moment.id]}
              onCheckedChange={(enabled) => onToggle({ moment: moment.id, enabled })}
              aria-label={moment.title}
            />
          }
        />
      ))}
    </>
  )
}
