import type { UserContentPart } from '../message/parts'

type PictureableEvent = {
  type: string
  modelParts?: readonly UserContentPart[] | undefined
  output?: unknown
}

type Block = Record<string, unknown>

const withheldPart = (part: UserContentPart): UserContentPart =>
  part.type === 'image' && part.bytes.kind === 'inline'
    ? { ...part, bytes: { kind: 'withheld' } }
    : part

const carriesInlinePicture = (part: UserContentPart): boolean =>
  part.type === 'image' && part.bytes.kind === 'inline'

const asBlock = (value: unknown): Block | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Block)
    : undefined

const carriesInlineBlock = (block: unknown): boolean => {
  const record = asBlock(block)
  return record?.['type'] === 'image' && typeof record['data'] === 'string'
}

const withheldBlock = (block: unknown): unknown => {
  if (!carriesInlineBlock(block)) return block
  const { data: _data, ...rest } = block as Block
  return { ...rest, withheld: true }
}

const withheldOutput = (output: unknown): unknown => {
  const record = asBlock(output)
  if (record === undefined) return output
  const content = record['content']
  if (!Array.isArray(content) || !content.some(carriesInlineBlock)) return output
  return { ...record, content: content.map(withheldBlock) }
}

export const PICTURE_BYTES_PATTERN = '"bytes":\\{"data":"[A-Za-z0-9+/=]*","kind":"inline"\\}'

export const PICTURE_BLOCK_PATTERN =
  '\\{"data":"[A-Za-z0-9+/=]*",("mimeType":"[^"]*"),"type":"image"\\}'

const WITHHELD_BYTES_TEXT = '"bytes":{"kind":"withheld"}'

const WITHHELD_BLOCK_TEXT = '{$1,"type":"image","withheld":true}'

const PICTURE_BYTES_REGEX = new RegExp(PICTURE_BYTES_PATTERN, 'g')

const PICTURE_BLOCK_REGEX = new RegExp(PICTURE_BLOCK_PATTERN, 'g')

export const withholdPictureText = (canonical: string): string =>
  canonical
    .replace(PICTURE_BYTES_REGEX, WITHHELD_BYTES_TEXT)
    .replace(PICTURE_BLOCK_REGEX, WITHHELD_BLOCK_TEXT)

const withheldParts = (
  parts: readonly UserContentPart[] | undefined,
): readonly UserContentPart[] | undefined => {
  if (parts === undefined || !parts.some(carriesInlinePicture)) return undefined
  return parts.map(withheldPart)
}

export const withholdPictureBytes = <TEvent extends PictureableEvent>(event: TEvent): TEvent => {
  if (event.type !== 'tool-result') return event
  const modelParts = withheldParts(event.modelParts)
  const output = withheldOutput(event.output)
  if (modelParts === undefined && output === event.output) return event
  return {
    ...event,
    ...(modelParts === undefined ? {} : { modelParts }),
    ...(output === event.output ? {} : { output }),
  } as TEvent
}
