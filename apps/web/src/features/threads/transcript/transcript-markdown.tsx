'use client'

import { useCallback, useEffect, useRef } from 'react'

import { MessageResponse, type MessageResponseProps } from '@dltech/atlas-ui/ai/message-response'

import { ELinkClickTarget, previewLinkRouteOf } from '../data/preview-link'
import { usePreviewsContext } from '../panel/previews-context'

const isAppLink = (href: string): boolean => {
  try {
    return new URL(href).origin === window.location.origin
  } catch {
    return false
  }
}

export function TranscriptMarkdown(props: Omit<MessageResponseProps, 'onLinkClick'>) {
  const previews = usePreviewsContext()
  const latest = useRef(previews)
  useEffect(() => {
    latest.current = previews
  }, [previews])
  const handleLinkClick: NonNullable<MessageResponseProps['onLinkClick']> = useCallback(
    ({ href, event }) => {
      if (isAppLink(href)) return
      const { ports, openUrl } = latest.current
      const route = previewLinkRouteOf({ href, ports, click: event })
      if (route === null) return
      event.preventDefault()
      if (route.target === ELinkClickTarget.Browser) {
        window.open(route.url, '_blank', 'noopener,noreferrer')
        return
      }
      openUrl(route.url)
    },
    [],
  )
  return <MessageResponse {...props} onLinkClick={handleLinkClick} />
}
