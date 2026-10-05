import type { ToolCall } from '../tool-runs'
import { EDetail, EGather, EToolClass, type Classification } from './kinds'
import { num, outputOf, relativise, str } from './reading'

export type ReadImage = {
  path: string
  mediaType: string
  width: number | null
  height: number | null
  byteLength: number | null
  /** The picture's base64 bytes, when the result inlined them for the model. */
  data: string | null
  /** Whether the bytes went to the model at all — a read can be text-only and still succeed. */
  inlined: boolean
  /** Why a text-only read stayed text-only, in the tool's own words. */
  notSentReason: string | null
}

export function imageOf(call: ToolCall): ReadImage | null {
  const output = outputOf(call)
  const mediaType = str(output.mediaType)
  const path = str(output.path)
  if (mediaType === undefined || path === undefined) return null
  if (!mediaType.startsWith('image/')) return null

  const inlined = output.inlined !== false

  return {
    path,
    mediaType,
    width: num(output.width) ?? null,
    height: num(output.height) ?? null,
    byteLength: num(output.byteLength) ?? null,
    data: call.image?.data ?? null,
    inlined,
    notSentReason: inlined ? null : (notSentReasonOf(call.modelText) ?? 'the tool kept it text-only'),
  }
}

const NOT_SENT = 'It was not sent to you because '

/** The reason a text-only image read gives the model, in the sentence the model was handed. */
function notSentReasonOf(modelText: string): string | undefined {
  const start = modelText.lastIndexOf(NOT_SENT)
  if (start === -1) return undefined

  return modelText.slice(start + NOT_SENT.length).replace(/\.s*$/, '')
}

const KILOBYTE = 1024

export function humanBytes(byteLength: number): string {
  if (byteLength < KILOBYTE) return `${byteLength} B`
  if (byteLength < KILOBYTE * KILOBYTE) return `${Math.round(byteLength / KILOBYTE)} KB`
  return `${(byteLength / KILOBYTE / KILOBYTE).toFixed(1)} MB`
}

const dimensionsOf = (image: ReadImage): string | null =>
  image.width === null || image.height === null ? null : `${image.width}×${image.height}`

const SEPARATOR = ' · '

export function imageSummary(args: { call: ToolCall; cwd: string }): string | null {
  const image = imageOf(args.call)
  if (image === null) return null

  const parts = [
    relativise(image.path, args.cwd),
    dimensionsOf(image),
    image.byteLength === null ? null : humanBytes(image.byteLength),
  ]

  return parts.filter((part): part is string => part !== null).join(SEPARATOR)
}

export function imageRead(args: { call: ToolCall; cwd: string }): Classification | null {
  const image = imageOf(args.call)
  if (image === null) return null

  const path = relativise(image.path, args.cwd)
  const measure =
    dimensionsOf(image) ?? (image.byteLength === null ? '' : humanBytes(image.byteLength))

  return {
    klass: EToolClass.Gathered,
    gather: EGather.Read,
    line: path,
    alone: `Read ${path}`,
    failed: false,
    note: measure,
    metric: null,
    detail: EDetail.Image,
  }
}
