'use client'

import { useEffect, useState, type CSSProperties } from 'react'

import { EMessageImageSize, MessageImageThumb } from '@dltech/atlas-ui/ai/message-images'

import { mediaUrls } from '../data/media-urls'
import type { ToolPictureItem } from '../data/transcript-tools'
import { toolPictures } from '../data/tool-pictures'
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

const naturalOf = (
  picture: ToolPictureItem['picture'],
): { width?: number | undefined; height?: number | undefined } => {
  if (picture.kind === 'media') return { width: picture.media.width, height: picture.media.height }
  if (picture.kind === 'withheld') return { width: picture.width, height: picture.height }
  return {}
}

const boxStyleOf = (box: Box): CSSProperties => ({
  width: box.width,
  height: box.height,
  maxWidth: '100%',
})

const inlineSrcOf = (picture: ToolPictureItem['picture']): string | undefined =>
  picture.kind === 'inline' ? `data:${picture.mediaType};base64,${picture.data}` : undefined

const initialOf = (picture: ToolPictureItem['picture']): Resolved => {
  const src = inlineSrcOf(picture)
  return src === undefined ? { kind: 'pending' } : { kind: 'src', src }
}

export function TranscriptToolPicture({ id, picture, alt, width, height }: ToolPictureItem) {
  const sessionId = useToolPictureSession()
  const [resolved, setResolved] = useState<Resolved>(() => initialOf(picture))
  const natural = naturalOf(picture)
  const box = toolPictureBox({ width: width ?? natural.width, height: height ?? natural.height })
  const style = boxStyleOf(box)

  useEffect(() => {
    const direct = inlineSrcOf(picture)
    if (direct !== undefined) {
      setResolved({ kind: 'src', src: direct })
      return
    }
    setResolved({ kind: 'pending' })
    if (sessionId === null) return
    let cancelled = false
    const loaded =
      picture.kind === 'media'
        ? mediaUrls.urlOf({ sessionId, hash: picture.media.hash })
        : picture.kind === 'withheld'
          ? toolPictures.dataUrlOf({ sessionId, ...picture })
          : Promise.resolve(undefined)
    loaded
      .then((src) => {
        if (cancelled) return
        setResolved(src === undefined ? { kind: 'failed' } : { kind: 'src', src })
      })
      .catch(() => {
        if (!cancelled) setResolved({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [picture, sessionId])

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
