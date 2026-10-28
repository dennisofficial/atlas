import type { SaidImageWire } from '@dltech/atlas-wire/web'

import {
  imageNameOf,
  JPEG_QUALITY,
  MAX_IMAGE_EDGE,
  PNG_DATA_BUDGET_CHARS,
  scaledSizeOf,
} from './composer-images'

const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

function encodeCanvas(args: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }): {
  mediaType: string
  data: string
} {
  const png = base64Of(args.canvas.toDataURL('image/png'))
  if (png.length <= PNG_DATA_BUDGET_CHARS) return { mediaType: 'image/png', data: png }
  args.context.globalCompositeOperation = 'destination-over'
  args.context.fillStyle = '#ffffff'
  args.context.fillRect(0, 0, args.canvas.width, args.canvas.height)
  return {
    mediaType: 'image/jpeg',
    data: base64Of(args.canvas.toDataURL('image/jpeg', JPEG_QUALITY)),
  }
}

export async function encodeImage(args: { file: File; index: number }): Promise<SaidImageWire> {
  const bitmap = await createImageBitmap(args.file)
  try {
    const { width, height } = scaledSizeOf({
      width: bitmap.width,
      height: bitmap.height,
      maxEdge: MAX_IMAGE_EDGE,
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas is unavailable')
    context.drawImage(bitmap, 0, 0, width, height)
    const { mediaType, data } = encodeCanvas({ canvas, context })
    return {
      path: imageNameOf({ fileName: args.file.name, index: args.index, mediaType }),
      mediaType,
      data,
      width,
      height,
    }
  } finally {
    bitmap.close()
  }
}
