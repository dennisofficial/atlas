import { z } from 'zod'

import { cloudJson, EHttpMethod } from '@/lib/cloud-api'

import { base64ToUtf8, encodeFileContent } from './file-encoding'

export const INSTRUCTIONS_TREE = 'instructions'
export const INSTRUCTIONS_PATH = '.atlas/ATLAS.md'

export type InstructionsDoc = { text: string; revision: number }

const filesSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      revision: z.number().int(),
      tombstonedAt: z.string().nullable(),
      content: z.string().nullable(),
    }),
  ),
})

const revisionSchema = z.object({ revision: z.number().int() })

export function docOf(body: z.infer<typeof filesSchema>): InstructionsDoc {
  const file = body.files.find((candidate) => candidate.path === INSTRUCTIONS_PATH)
  if (file === undefined) return { text: '', revision: 0 }
  const live = file.tombstonedAt === null && file.content !== null
  return { text: live ? base64ToUtf8(file.content ?? '') : '', revision: file.revision }
}

export async function fetchInstructions(): Promise<InstructionsDoc> {
  const body = await cloudJson({
    method: EHttpMethod.Post,
    path: '/v1/user-files/get',
    body: { tree: INSTRUCTIONS_TREE, paths: [INSTRUCTIONS_PATH] },
    schema: filesSchema,
  })
  return docOf(body)
}

export async function saveInstructions(args: {
  text: string
  baseRevision: number
}): Promise<InstructionsDoc> {
  const encoded = await encodeFileContent(args.text)
  const body = await cloudJson({
    method: EHttpMethod.Put,
    path: `/v1/user-files/${INSTRUCTIONS_TREE}/${INSTRUCTIONS_PATH}`,
    body: { ...encoded, baseRevision: args.baseRevision },
    schema: revisionSchema,
  })
  return { text: args.text, revision: body.revision }
}
