import {
  MAX_INLINE_BYTES,
  type AgentFileSystemPort,
  type ModelPart,
  type NativeFileMediaType,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { humanBytes } from './read-image'

export type FileReadOutput = {
  path: string
  mediaType: NativeFileMediaType
  byteLength: number
  inlined: boolean
}

const basename = (path: string): string => path.split('/').pop() ?? path

const describe = (args: {
  path: string
  mediaType: NativeFileMediaType
  byteLength: number
}): string => `${args.path} — ${args.mediaType}, ${humanBytes(args.byteLength)}.`

const textOnly = (args: {
  path: string
  mediaType: NativeFileMediaType
  byteLength: number
  because: string
}): ToolOutcome => ({
  ok: true,
  output: { path: args.path, mediaType: args.mediaType, byteLength: args.byteLength, inlined: false },
  modelText: `${describe(args)} It was not sent to you because ${args.because}.`,
})

export async function readFile(args: {
  path: string
  mediaType: NativeFileMediaType
  byteLength: number
  files: AgentFileSystemPort
  threadId: ThreadId
}): Promise<ToolOutcome> {
  const { path, mediaType, byteLength } = args

  if (byteLength > MAX_INLINE_BYTES) {
    return textOnly({
      path,
      mediaType,
      byteLength,
      because: `${humanBytes(byteLength)} is past the ${humanBytes(MAX_INLINE_BYTES)} inline limit`,
    })
  }

  const bytes = await args.files.readBytes({ path, threadId: args.threadId })

  const summary = describe(args)
  const parts: readonly ModelPart[] = [
    { type: 'text', text: summary },
    {
      type: 'file',
      data: Buffer.from(bytes).toString('base64'),
      mediaType,
      filename: basename(path),
      source: path,
    },
  ]

  return {
    ok: true,
    output: { path, mediaType, byteLength, inlined: true } satisfies FileReadOutput,
    modelText: summary,
    modelParts: parts,
  }
}
