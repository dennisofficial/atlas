'use client'

import { useCallback, useEffect, useRef } from 'react'

import { MessageResponse, type MessageResponseProps } from '@dltech/atlas-ui/ai/message-response'

import { previewLinkRouteOf } from '../data/preview-ports'
import { usePreviewsContext } from '../panel/previews-context'

export function TranscriptMarkdown(props: Omit<MessageResponseProps, 'onLinkClick'>) {
  const previews = usePreviewsContext()
  const latest = useRef(previews)
  useEffect(() => {
    latest.current = previews
  }, [previews])
  const handleLinkClick: NonNullable<MessageResponseProps['onLinkClick']> = useCallback(
    ({ href, event }) => {
      const { ports, openUrl } = latest.current
      const route = previewLinkRouteOf({ href, ports, click: event })
      if (route === null) return
      event.preventDefault()
      openUrl(route)
    },
    [],
  )
  return <MessageResponse {...props} onLinkClick={handleLinkClick} />
}
