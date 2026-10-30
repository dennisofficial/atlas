import React from 'react'

import { Services } from '../ui/components/services'
import type { ServicesControl } from './use-services'

export function ServicesOverlay(props: {
  services: ServicesControl
  width: number
}): React.ReactNode {
  const { services, width } = props
  if (services.state === null) return null
  return (
    <Services
      width={width}
      rows={services.rows}
      now={services.now}
      selected={services.selected}
      log={services.log}
      scroll={services.scroll}
      overlay
      notice={services.notice}
      onStart={services.handleStart}
      onRestart={services.handleRestart}
      onStop={services.handleStop}
      onDismiss={services.handleDismiss}
    />
  )
}
