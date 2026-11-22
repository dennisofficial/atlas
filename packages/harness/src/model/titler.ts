import {
  inlinable,
  sanitizedTitle,
  SESSION_TITLE_INSTRUCTION,
  type SaidImage,
} from '@dltech/atlas-core'
import { generateText, Output, type LanguageModel, type ModelMessage } from 'ai'
import { z } from 'zod'

import { NO_SDK_RETRIES } from './no-sdk-retries'

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
  model: LanguageModel
  text: string
  images?: readonly SaidImage[] | undefined
  signal?: AbortSignal | undefined
  fallback?: (() => LanguageModel | undefined) | undefined
  onFault?: ((fault: unknown) => void) | undefined
}): Promise<string | null> {
  const asked = args.text.trim()
  const shown = (args.images ?? []).filter((image) => inlinable(image))
  if (asked.length === 0 && shown.length === 0) return null

  const attempt = async (model: LanguageModel): Promise<string | null> => {
    const generated = await generateText({
      model,
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

  const attempted = (model: LanguageModel): Promise<string | null> =>
    attempt(model).catch((fault: unknown) => {
      args.onFault?.(fault)
      return null
    })

  const named = await attempted(args.model)
  if (named !== null) return named

  const fallback = args.fallback?.()
  if (fallback === undefined) return null

  return await attempted(fallback)
}
