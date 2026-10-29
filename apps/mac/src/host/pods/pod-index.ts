import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

export const POD_INDEX_NAME = 'desktop-pods.json'

const entrySchema = z.object({
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  model: z.string().optional(),
  effort: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.iso.datetime(),
})
export type PodIndexEntry = z.infer<typeof entrySchema>

const fileSchema = z.object({ pods: z.array(entrySchema) })

export interface IPodIndex {
  list: () => PodIndexEntry[]
  find: (args: { threadId: string }) => PodIndexEntry | undefined
  put: (entry: PodIndexEntry) => void
  remove: (args: { threadId: string }) => void
}

export function createPodIndex({ home }: { home: string }): IPodIndex {
  const file = join(home, POD_INDEX_NAME)

  const load = (): PodIndexEntry[] => {
    try {
      return fileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).pods
    } catch {
      return []
    }
  }

  const save = (pods: PodIndexEntry[]): void => {
    mkdirSync(dirname(file), { recursive: true })
    const staging = `${file}.${process.pid}.tmp`
    writeFileSync(staging, JSON.stringify({ pods }, null, 2))
    renameSync(staging, file)
  }

  return {
    list: load,
    find: ({ threadId }) => load().find((entry) => entry.threadId === threadId),
    put: (entry) => save([...load().filter((held) => held.threadId !== entry.threadId), entry]),
    remove: ({ threadId }) => save(load().filter((entry) => entry.threadId !== threadId)),
  }
}
