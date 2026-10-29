import { useEffect } from 'react'

import type { ThreadSignalHub } from './thread-signal-hub'

export function useTitleRefresh(args: {
  signals: ThreadSignalHub
  titled: boolean
  reload: () => void
}) {
  const { signals, titled, reload } = args

  useEffect(
    () =>
      signals.listen({
        onTitle: reload,
        onStarted: () => {
          if (!titled) reload()
        },
      }),
    [signals, titled, reload],
  )
}
