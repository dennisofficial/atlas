import React from 'react'

import { useClickRegion } from '../hooks/use-click-region'
import { theme } from '../theme'

const LABEL = '[close]'

export function CloseButton(props: { onClose: () => void; bg?: string }): React.ReactNode {
  const region = useClickRegion(props.onClose)
  return (
    <text
      width={LABEL.length}
      height={1}
      flexShrink={0}
      fg={region.hovered ? theme.bright : theme.hint}
      bg={region.wash.bg ?? props.bg ?? theme.overlayBg}
      {...region.handlers}
    >
      {LABEL}
    </text>
  )
}
