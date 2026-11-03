import * as Updates from 'expo-updates'

import type { IUpdateInfo } from './use-settings'

export const createUpdateInfo = ({
  setState,
}: {
  setState: React.Dispatch<React.SetStateAction<IUpdateInfo>>
}): Pick<IUpdateInfo, 'enabled' | 'channel' | 'updateId' | 'runtimeVersion' | 'check'> => {
  const check = async () => {
    setState((previous) => ({ ...previous, checking: true, status: '' }))
    try {
      const update = await Updates.checkForUpdateAsync()
      if (!update.isAvailable) {
        setState((previous) => ({ ...previous, checking: false, status: 'Up to date' }))
        return
      }
      setState((previous) => ({ ...previous, status: 'Downloading…' }))
      await Updates.fetchUpdateAsync()
      setState((previous) => ({ ...previous, checking: false, status: 'Restarting…' }))
      await Updates.reloadAsync()
    } catch {
      setState((previous) => ({
        ...previous,
        checking: false,
        status: 'The update check failed',
      }))
    }
  }
  return {
    enabled: Updates.isEnabled,
    channel: Updates.channel ?? 'development',
    updateId: Updates.updateId ?? 'embedded',
    runtimeVersion: Updates.runtimeVersion ?? '',
    check,
  }
}
