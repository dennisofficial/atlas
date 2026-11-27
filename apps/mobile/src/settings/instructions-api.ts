import type { ApiClient } from '@dltech/atlas-api-router'
import {
  INSTRUCTIONS_PATH,
  INSTRUCTIONS_TREE,
  type TInstructionsDoc,
  instructionsOf,
} from '@dltech/atlas-client/settings'
import { sha256Hex } from '../auth/pkce'

const base64ToUtf8 = (encoded: string): string => {
  const binary = atob(encoded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

const utf8ToBase64 = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const encodeContentOf = async (
  text: string,
): Promise<{ content: string; contentHash: string }> => ({
  content: utf8ToBase64(text),
  contentHash: await sha256Hex({ value: text }),
})

export const loadPersonalInstructions = async ({
  api,
}: {
  api: ApiClient
}): Promise<TInstructionsDoc> => {
  const body = await api.userFiles.get.mutate({
    tree: INSTRUCTIONS_TREE,
    paths: [INSTRUCTIONS_PATH],
  })
  return instructionsOf({ files: body.files, decode: base64ToUtf8 })
}

export const savePersonalInstructions = async ({
  api,
  text,
  baseRevision,
}: {
  api: ApiClient
  text: string
  baseRevision: number
}): Promise<TInstructionsDoc> => {
  const body = await api.userFiles.put.mutate({
    tree: INSTRUCTIONS_TREE,
    path: INSTRUCTIONS_PATH,
    ...(await encodeContentOf(text)),
    baseRevision,
  })
  return { text, revision: body.revision }
}

export type TGroupInstructionsDoc = { content: string; updatedAt: string | null }

export const loadGroupInstructions = ({
  api,
  groupId,
}: {
  api: ApiClient
  groupId: string
}): Promise<TGroupInstructionsDoc> => api.groupResources.instructions.query({ groupId })

export const saveGroupInstructions = async ({
  api,
  groupId,
  content,
}: {
  api: ApiClient
  groupId: string
  content: string
}): Promise<void> => {
  await api.groupResources.saveInstructions.mutate({ groupId, content })
}
