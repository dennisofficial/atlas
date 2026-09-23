import type { Message, ToolMessage, UserMessage } from './message'
import type { ImagePart, TextPart, ToolResultPart } from './parts'

const PLACEHOLDER_TEXT = 'the image is attached in the next message'

const anchorFor = (images: readonly ImagePart[]): string => {
  const sources = images.flatMap((image) => (image.source === undefined ? [] : [image.source]))
  if (sources.length === 0) return 'Images from the tool result above.'
  return `Images from the tool result above: ${sources.join(', ')}.`
}

function splitPart(part: ToolResultPart): { kept: ToolResultPart; images: ImagePart[] } {
  if (part.output.type !== 'content') return { kept: part, images: [] }

  const images = part.output.value.filter((inner): inner is ImagePart => inner.type === 'image')
  if (images.length === 0) return { kept: part, images: [] }

  const rest = part.output.value.filter((inner): inner is TextPart => inner.type === 'text')
  const value: readonly TextPart[] =
    rest.length > 0 ? rest : [{ type: 'text', text: PLACEHOLDER_TEXT }]

  return { kept: { ...part, output: { type: 'content', value } }, images }
}

/**
 * The chat-completions wire format has no image block in tool messages, so a tool-result image
 * sent there arrives as stringified base64 text — a model billed at imageTier standard then
 * hallucinates over noise it cannot see. Hoisting moves the images into a user message right
 * after the tool message, which the format does carry as image_url parts.
 */
export function hoistToolResultImages(args: { messages: readonly Message[] }): Message[] {
  const hoisted: Message[] = []

  for (const message of args.messages) {
    if (message.role !== 'tool') {
      hoisted.push(message)
      continue
    }

    const split = message.content.map(splitPart)
    const images = split.flatMap((part) => part.images)
    const toolMessage: ToolMessage = {
      role: 'tool',
      content: split.map((part) => part.kept),
      ...(message.providerOptions === undefined ? {} : { providerOptions: message.providerOptions }),
    }
    hoisted.push(toolMessage)

    if (images.length === 0) continue

    const anchor: UserMessage = {
      role: 'user',
      content: [...images, { type: 'text', text: anchorFor(images) }],
    }
    hoisted.push(anchor)
  }

  return hoisted
}
