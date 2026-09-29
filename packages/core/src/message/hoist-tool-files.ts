import type { Message, ToolMessage, UserMessage } from './message'
import type { FilePart, ImagePart, TextPart, ToolResultPart } from './parts'

const PLACEHOLDER_TEXT = 'the attachment is in the next message'

const anchorFor = (parts: readonly (ImagePart | FilePart)[]): string => {
  const sources = parts.flatMap((part) => (part.source === undefined ? [] : [part.source]))
  const imageCount = parts.filter((part) => part.type === 'image').length
  const fileCount = parts.length - imageCount
  const label =
    fileCount === 0
      ? imageCount === 1
        ? 'Image'
        : 'Images'
      : imageCount === 0
        ? fileCount === 1
          ? 'File'
          : 'Files'
        : 'Attachments'
  const where = sources.length === 0 ? '' : `: ${sources.join(', ')}`
  return `${label} from the tool result above${where}.`
}

function splitPart(part: ToolResultPart): { kept: ToolResultPart; files: (ImagePart | FilePart)[] } {
  if (part.output.type !== 'content') return { kept: part, files: [] }

  const files = part.output.value.filter(
    (inner): inner is ImagePart | FilePart => inner.type === 'image' || inner.type === 'file',
  )
  if (files.length === 0) return { kept: part, files: [] }

  const rest = part.output.value.filter((inner): inner is TextPart => inner.type === 'text')
  const value: readonly TextPart[] =
    rest.length > 0 ? rest : [{ type: 'text', text: PLACEHOLDER_TEXT }]

  return { kept: { ...part, output: { type: 'content', value } }, files }
}

/**
 * The chat-completions wire format has no image or file block in tool messages, so a tool-result
 * file sent there arrives as stringified base64 text — a model billed at imageTier standard then
 * hallucinates over noise it cannot see. Hoisting moves the files into a user message right
 * after the tool message, which the format does carry as image_url and file parts.
 */
export function hoistToolResultFiles(args: { messages: readonly Message[] }): Message[] {
  const hoisted: Message[] = []

  for (const message of args.messages) {
    if (message.role !== 'tool') {
      hoisted.push(message)
      continue
    }

    const split = message.content.map(splitPart)
    const files = split.flatMap((part) => part.files)
    const toolMessage: ToolMessage = {
      role: 'tool',
      content: split.map((part) => part.kept),
      ...(message.providerOptions === undefined ? {} : { providerOptions: message.providerOptions }),
    }
    hoisted.push(toolMessage)

    if (files.length === 0) continue

    const anchor: UserMessage = {
      role: 'user',
      content: [...files, { type: 'text', text: anchorFor(files) }],
    }
    hoisted.push(anchor)
  }

  return hoisted
}
