'use client'

import { useEffect, useState, type CSSProperties } from 'react'

import { EMessageImageSize, MessageImageThumb } from '@dltech/atlas-ui/ai/message-images'

import { mediaUrls } from '../data/media-urls'
import type { ToolPictureItem } from '../data/transcript-tools'
import { useToolPictureSession } from './tool-picture-session'

type Resolved = { kind: 'src'; src: string } | { kind: 'pending' } | { kind: 'failed' }

type Box = { width: number; height: number }

export const TOOL_PICTURE_MAX_HEIGHT = 320

const FALLBACK_BOX: Box = { width: 256, height: 192 }

export const toolPictureBox = (size: {
  width?: number | undefined
  height?: number | undefined
}): Box => {
  const { width, height } = size
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return FALLBACK_BOX
  const scale = Math.min(1, TOOL_PICTURE_MAX_HEIGHT / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

const boxStyleOf = (box: Box): CSSProperties => ({
  width: box.width,
  height: box.height,
  maxWidth: '100%',
})

export function TranscriptToolPicture({ id, picture, alt, width, height }: ToolPictureItem) {
  const sessionId = useToolPictureSession()
  const [resolved, setResolved] = useState<Resolved>({ kind: 'pending' })
  const box = toolPictureBox({
    width: width ?? picture.media.width,
    height: height ?? picture.media.height,
  })
  const style = boxStyleOf(box)
  const hash = picture.media.hash

  useEffect(() => {
    setResolved({ kind: 'pending' })
    if (sessionId === null) return
    let cancelled = false
    mediaUrls
      .urlOf({ sessionId, hash })
      .then((src) => {
        if (!cancelled) setResolved({ kind: 'src', src })
      })
      .catch(() => {
        if (!cancelled) setResolved({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [hash, sessionId])

  if (resolved.kind === 'src')
    return (
      <div data-slot="tool-picture" className="overflow-hidden" style={style}>
        <MessageImageThumb
          image={{ id, src: resolved.src, alt }}
          size={EMessageImageSize.Preview}
        />
      </div>
    )

  return (
    <div
      data-slot="tool-picture"
      className="rounded-lg bg-muted ring-1 ring-foreground/10"
      style={style}
      {...(resolved.kind === 'failed'
        ? { role: 'img', 'aria-label': alt, title: alt }
        : { 'aria-hidden': true })}
    />
  )
}
