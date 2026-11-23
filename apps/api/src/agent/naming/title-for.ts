import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  inlinable,
  sanitizedTitle,
  SESSION_TITLE_INSTRUCTION,
  type SaidImage,
} from '@dltech/atlas-core'
import { generateText, Output, type ModelMessage } from 'ai'
import { z } from 'zod'

const NO_SDK_RETRIES = 0

const TITLE_SCHEMA = z.object({ name: z.string() })

const askWithImages = (args: { asked: string; images: readonly SaidImage[] }): ModelMessage[] => [
  {
    role: 'user',
    content: [
      ...(args.asked.length === 0 ? [] : [{ type: 'text' as const, text: args.asked }]),
      ...args.images.map((image) => ({
        type: 'file' as const,
        data: image.data,
        mediaType: image.mediaType,
      })),
    ],
  },
]

export async function titleFor(args: {
  model: () => LanguageModelV4
  fallback?: (() => LanguageModelV4) | undefined
  text: string
  images?: readonly SaidImage[] | undefined
  signal?: AbortSignal | undefined
  onFault?: ((fault: unknown) => void) | undefined
}): Promise<string | null> {
  const asked = args.text.trim()
  const shown = (args.images ?? []).filter((image) => inlinable(image))
  if (asked.length === 0 && shown.length === 0) return null

  const attempt = async (model: () => LanguageModelV4): Promise<string | null> => {
    const generated = await generateText({
      model: model(),
      system: SESSION_TITLE_INSTRUCTION,
      ...(shown.length === 0
        ? { prompt: asked }
        : { messages: askWithImages({ asked, images: shown }) }),
      output: Output.object({ schema: TITLE_SCHEMA }),
      maxRetries: NO_SDK_RETRIES,
      ...(args.signal === undefined ? {} : { abortSignal: args.signal }),
    })
    return sanitizedTitle(generated.output.name)
  }

  const fallbackAfter = async (fault: unknown): Promise<string | null> => {
    if (args.fallback === undefined || args.signal?.aborted === true) throw fault
    return await attempt(args.fallback)
  }

  try {
    return await attempt(args.model).catch(fallbackAfter)
  } catch (fault) {
    args.onFault?.(fault)
    return null
  }
}
