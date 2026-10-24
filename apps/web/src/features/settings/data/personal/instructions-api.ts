import { EUserFileTree } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import { base64ToUtf8, encodeFileContent } from './file-encoding'

type FilesReply = Awaited<ReturnType<typeof api.userFiles.get.mutate>>

export const INSTRUCTIONS_TREE = EUserFileTree.Instructions
export const INSTRUCTIONS_PATH = '.atlas/ATLAS.md'

export type InstructionsDoc = { text: string; revision: number }

export function docOf(body: FilesReply): InstructionsDoc {
  const file = body.files.find((candidate) => candidate.path === INSTRUCTIONS_PATH)
  if (file === undefined) return { text: '', revision: 0 }
  const live = file.tombstonedAt === null && file.content !== null
  return { text: live ? base64ToUtf8(file.content ?? '') : '', revision: file.revision }
}

export async function fetchInstructions(): Promise<InstructionsDoc> {
  const body = await cloudCall(
    api.userFiles.get.mutate({ tree: INSTRUCTIONS_TREE, paths: [INSTRUCTIONS_PATH] }),
  )
  return docOf(body)
}

export async function saveInstructions(args: {
  text: string
  baseRevision: number
}): Promise<InstructionsDoc> {
  const encoded = await encodeFileContent(args.text)
  const body = await cloudCall(
    api.userFiles.put.mutate({
      tree: INSTRUCTIONS_TREE,
      path: INSTRUCTIONS_PATH,
      ...encoded,
      baseRevision: args.baseRevision,
    }),
  )
  return { text: args.text, revision: body.revision }
}
