import type {
  ESkillScope,
  SkillFileContent,
  SkillFileMeta,
  SkillSummary,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { CloudApiError } from '@/lib/cloud-api'

export type SkillScopeTarget = { scope: ESkillScope; projectId?: string }

const CONFLICT = 409

export const isSkillConflict = (failure: unknown): boolean =>
  failure instanceof CloudApiError && failure.status === CONFLICT

export async function listSkills(target: SkillScopeTarget): Promise<SkillSummary[]> {
  const body = await cloudCall(api.skills.list.query(target))
  return body.skills
}

export async function listSkillFiles(
  target: SkillScopeTarget & { skill: string },
): Promise<SkillFileMeta[]> {
  const body = await cloudCall(api.skills.listFiles.query(target))
  return body.files
}

export async function getSkillFile(
  target: SkillScopeTarget & { skill: string; path: string },
): Promise<SkillFileContent> {
  return cloudCall(api.skills.get.query(target))
}

export async function putSkillFile(
  target: SkillScopeTarget & {
    skill: string
    path: string
    content: string
    contentHash: string
    baseRevision?: number
  },
): Promise<number> {
  const body = await cloudCall(api.skills.put.mutate(target))
  return body.revision
}

export async function removeSkillFile(
  target: SkillScopeTarget & { skill: string; path: string; baseRevision: number },
): Promise<void> {
  await cloudCall(api.skills.remove.mutate(target))
}

export async function removeSkill(target: SkillScopeTarget & { skill: string }): Promise<number> {
  const body = await cloudCall(api.skills.removeSkill.mutate(target))
  return body.removed
}

const bytesOfUtf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

export function bytesOfBase64(content: string): Uint8Array<ArrayBuffer> {
  const binary = atob(content)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function fromBase64Utf8(content: string): string {
  return new TextDecoder().decode(bytesOfBase64(content))
}

export function base64OfBytes(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function toBase64Utf8(text: string): string {
  return base64OfBytes(bytesOfUtf8(text))
}

export async function fileToBase64(file: File): Promise<string> {
  return base64OfBytes(new Uint8Array(await file.arrayBuffer()))
}

export async function sha256HexOfBase64(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytesOfBase64(content))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type SkillSaveOutcome =
  | { outcome: 'saved'; revision: number }
  | { outcome: 'conflict'; theirs: string; revision: number }

export async function saveSkillText(
  target: SkillScopeTarget & { skill: string; path: string; baseRevision: number },
  text: string,
): Promise<SkillSaveOutcome> {
  const { baseRevision, ...file } = target
  const content = toBase64Utf8(text)
  try {
    const revision = await putSkillFile({
      ...file,
      content,
      contentHash: await sha256HexOfBase64(content),
      baseRevision,
    })
    return { outcome: 'saved', revision }
  } catch (failure) {
    if (!isSkillConflict(failure)) throw failure
    const fresh = await getSkillFile(file)
    return { outcome: 'conflict', theirs: fromBase64Utf8(fresh.content), revision: fresh.revision }
  }
}
