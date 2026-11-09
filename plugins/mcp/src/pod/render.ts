import type { ImagePart, ModelPart, TextPart } from '@dltech/atlas-core'

import { asRecord, type McpCallResult } from './types'

export const MAX_MODEL_TEXT_CHARACTERS = 30_000

const TRUNCATION_NOTE = `[the result exceeded ${MAX_MODEL_TEXT_CHARACTERS} characters, so this text is the front of it]`

export type RenderedResult = {
  text: string
  parts: readonly ModelPart[]
  hasImages: boolean
}

const capText = (text: string): string =>
  text.length <= MAX_MODEL_TEXT_CHARACTERS
    ? text
    : `${text.slice(0, MAX_MODEL_TEXT_CHARACTERS)}\n${TRUNCATION_NOTE}`

const textBlockOf = (block: unknown): string | undefined => {
  const record = asRecord(block)
  if (record === undefined || record['type'] !== 'text') return undefined
  return typeof record['text'] === 'string' ? record['text'] : undefined
}

const imageBlockOf = (block: unknown): ImagePart | undefined => {
  const record = asRecord(block)
  if (record === undefined || record['type'] !== 'image') return undefined
  const data = record['data']
  const mediaType = record['mimeType']
  if (typeof data !== 'string' || typeof mediaType !== 'string') return undefined
  return { type: 'image', bytes: { kind: 'inline', data }, mediaType }
}

const blockNameOf = (block: unknown): string => {
  const record = asRecord(block)
  const type = record?.['type']
  return typeof type === 'string' ? type : 'unknown'
}

const stringifyRaw = (raw: unknown): string =>
  typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? '')

export const renderContent = (raw: unknown): RenderedResult => {
  if (raw === undefined) return { text: '', parts: [], hasImages: false }

  if (!Array.isArray(raw)) {
    const text = capText(stringifyRaw(raw))
    return { text, parts: [{ type: 'text', text }], hasImages: false }
  }

  const texts: TextPart[] = []
  const images: ImagePart[] = []
  const dropped: string[] = []
  for (const block of raw) {
    const image = imageBlockOf(block)
    const text = textBlockOf(block)
    if (image !== undefined) images.push(image)
    else if (text !== undefined) texts.push({ type: 'text', text })
    else dropped.push(blockNameOf(block))
  }

  const notes = dropped.map(
    (name) => `[one ${name} block was dropped because Atlas renders text and images only]`,
  )
  const text = capText([...texts.map((part) => part.text), ...notes].join('\n'))
  return { text, parts: [{ type: 'text', text }, ...images], hasImages: images.length > 0 }
}

export const renderCall = (result: McpCallResult): RenderedResult =>
  renderContent(result.structuredContent ?? result.content)
