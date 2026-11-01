import { z } from 'zod'

import type { SaidFile, SaidImage, SaidUpload } from './body'
import { saidFileSchema, saidImageSchema, saidUploadSchema } from './part-schema'

export type ForkEvent = { seq: number; type: string; body: unknown }

export type OrphanedInput = {
  text: string
  requestId?: string | undefined
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  uploads?: readonly SaidUpload[] | undefined
}

export type DiscardedForkEvent = { seq: number; type: string }

export type ForkOrphans = { inputs: OrphanedInput[]; discarded: DiscardedForkEvent[] }

const USER_SAID = 'user-said'

const saidFieldsSchema = z.object({
  text: z.string(),
  requestId: z.string().min(1).optional().catch(undefined),
  images: z.array(saidImageSchema).optional().catch(undefined),
  files: z.array(saidFileSchema).optional().catch(undefined),
  uploads: z.array(saidUploadSchema).optional().catch(undefined),
})

const inputOf = (event: ForkEvent): OrphanedInput | undefined => {
  if (event.type !== USER_SAID) return undefined
  const parsed = saidFieldsSchema.safeParse(event.body)
  if (!parsed.success) return undefined
  const { text, requestId, images, files, uploads } = parsed.data
  return {
    text,
    ...(requestId === undefined ? {} : { requestId }),
    ...(images === undefined ? {} : { images }),
    ...(files === undefined ? {} : { files }),
    ...(uploads === undefined ? {} : { uploads }),
  }
}

const localInputsOf = (local: readonly ForkEvent[]): OrphanedInput[] =>
  local.flatMap((event) => inputOf(event) ?? [])

export function orphanedInputsOf({
  remote,
  local,
}: {
  remote: readonly ForkEvent[]
  local: readonly ForkEvent[]
}): ForkOrphans {
  const known = localInputsOf(local)
  const seenRequestIds = new Set(known.flatMap((input) => input.requestId ?? []))
  const seenTexts = new Set(known.map((input) => input.text))
  const inputs: OrphanedInput[] = []
  const discarded: DiscardedForkEvent[] = []

  for (const event of remote) {
    const input = inputOf(event)
    if (input === undefined) {
      discarded.push({ seq: event.seq, type: event.type })
      continue
    }
    const { requestId } = input
    const landed =
      requestId === undefined ? seenTexts.has(input.text) : seenRequestIds.has(requestId)
    if (landed) continue
    if (requestId !== undefined) seenRequestIds.add(requestId)
    inputs.push(input)
  }
  return { inputs, discarded }
}
