import type { ApiClient } from '@dltech/atlas-api-router'
import {
  fromBase64Utf8,
  saveSkillTextWith,
  skillFileWriteOf,
  skillPathContains,
  skillRenamePlan,
  toBase64Utf8,
  type SkillFileTarget,
  type SkillFileWrite,
  type SkillScopeTarget,
} from '@dltech/atlas-client/settings'

export type SkillTarget = SkillScopeTarget & { skill: string }

export const skillFilesApi = ({
  api,
  target,
  hashOf,
}: {
  api: ApiClient
  target: SkillTarget
  hashOf: (content: string) => Promise<string>
}) => {
  const list = async () => (await api.skills.listFiles.query(target)).files
  const read = (input: SkillFileTarget) => api.skills.get.query(input)
  const put = async (input: SkillFileWrite) => (await api.skills.put.mutate(input)).revision
  const write = async ({
    path,
    content,
    baseRevision,
  }: {
    path: string
    content: string
    baseRevision?: number
  }) => {
    return put(
      await skillFileWriteOf({
        target: { ...target, path },
        content,
        baseRevision,
        hashOf,
      }),
    )
  }
  return {
    list,
    read: ({ path }: { path: string }) => read({ ...target, path }),
    readText: async ({ path }: { path: string }) => {
      const file = await read({ ...target, path })
      return { text: fromBase64Utf8(file.content), revision: file.revision }
    },
    write,
    addText: ({ path }: { path: string }) => write({ path, content: toBase64Utf8('') }),
    save: ({ path, text, baseRevision }: { path: string; text: string; baseRevision: number }) =>
      saveSkillTextWith({
        target: { ...target, path, baseRevision },
        text,
        hashOf,
        put,
        read,
      }),
    remove: async ({ path }: { path: string }) => {
      const files = (await list()).filter((file) =>
        skillPathContains({ parent: path, path: file.path }),
      )
      for (const file of files)
        await api.skills.remove.mutate({ ...target, path: file.path, baseRevision: file.revision })
    },
    rename: async ({ from, to }: { from: string; to: string }) => {
      const plan = skillRenamePlan({ files: await list(), from, to })
      for (const { file, path } of plan) {
        const current = await read({ ...target, path: file.path })
        await put({
          ...target,
          path,
          content: current.content,
          contentHash: current.contentHash,
          baseRevision: 0,
        })
        await api.skills.remove.mutate({
          ...target,
          path: file.path,
          baseRevision: current.revision,
        })
      }
    },
    removeSkill: () => api.skills.removeSkill.mutate(target),
  }
}

export type SkillFilesApi = ReturnType<typeof skillFilesApi>
