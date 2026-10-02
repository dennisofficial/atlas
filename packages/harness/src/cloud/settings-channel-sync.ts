import { serialiseSettingsDocument } from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'
import type { RemoteDeltaChannel } from './remote-delta-channel'

export function bindChannelSettingsSync(args: {
  channel: Pick<RemoteDeltaChannel, 'syncSettings' | 'onReady'>
  settings: SettingsService
}): () => void {
  const { channel, settings } = args
  let lastSent: string | undefined

  const currentContent = (): string => serialiseSettingsDocument(settings.snapshot().document)

  const push = (): void => {
    const content = currentContent()
    if (content === lastSent) return
    lastSent = content
    channel.syncSettings({ content })
  }

  const handleReady = (): void => {
    const content = currentContent()
    lastSent = content
    channel.syncSettings({ content })
  }

  const stopSettings = settings.subscribe(push)
  const stopReady = channel.onReady(handleReady)

  return () => {
    stopSettings()
    stopReady()
  }
}
