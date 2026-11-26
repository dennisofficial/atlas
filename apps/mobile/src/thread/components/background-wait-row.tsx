import { ETraceStatus, Spinner, Trace, TraceLine, useTheme } from '@dltech/atlas-ui-native'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { waitElapsedOf, type BackgroundWait } from '../session/background-wait'

const TICK_MS = 1_000

export const BackgroundWaitRow = ({ wait }: { wait: BackgroundWait }) => {
  const theme = useTheme()
  const [held, setHeld] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setHeld(Date.now())
  }, [wait.settledAt])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <View accessible accessibilityLabel={wait.label} accessibilityLiveRegion="polite">
      <Trace>
        <TraceLine
          icon={<Spinner color={theme.mutedForeground} />}
          title={wait.label}
          description={waitElapsedOf({ wait, held, now })}
          status={ETraceStatus.Running}
        />
      </Trace>
    </View>
  )
}
