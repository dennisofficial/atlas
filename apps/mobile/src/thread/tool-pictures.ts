import { imageOf, type ToolRun } from '@dltech/atlas-client/transcript'

export type ToolPictureView = {
  id: string
  hash: string
  alt: string
  width: number
  height: number
}

export const TOOL_PICTURE_MAX_HEIGHT = 320

const fileNameOf = (path: string): string => path.split('/').at(-1) || path

export const picturesIn = (run: ToolRun): ToolPictureView[] =>
  run.calls.flatMap((call) => {
    const read = imageOf(call)
    if (call.image === undefined || read === null) return []
    return [
      {
        id: `${call.callId}#image`,
        hash: call.image.media.hash,
        alt: fileNameOf(read.path),
        width: call.image.media.width,
        height: call.image.media.height,
      },
    ]
  })

export const pictureBoxOf = (picture: {
  width: number
  height: number
}): { width: number; aspectRatio: number } => {
  if (picture.width <= 0 || picture.height <= 0) return { width: 256, aspectRatio: 4 / 3 }
  const scale = Math.min(1, TOOL_PICTURE_MAX_HEIGHT / picture.height)
  return { width: Math.round(picture.width * scale), aspectRatio: picture.width / picture.height }
}
