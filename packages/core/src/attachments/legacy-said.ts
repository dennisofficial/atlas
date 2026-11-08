import type { MediaRef } from '../media/media-ref'

export type SaidImage = {
  path: string
  mediaType: string
  data: string
  width?: number | undefined
  height?: number | undefined
}

export type SaidFile = {
  path: string
  mediaType: string
  data: string
  filename?: string | undefined
}

export type SaidMedia = {
  media: MediaRef
  source?: string | undefined
}

export type SaidUpload = {
  uploadId: string
  pathname: string
  name: string
  size: number
  mediaType: string
}
