import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { writeFileAtomically } from '../files/atomic-write'

const PUSH_DIRECTORY_NAME = 'push'
const LAST_PUSH_FILE_NAME = 'last-push.json'

const publishStateSchema = z.object({
  version: z.number().int().nonnegative(),
  items: z.record(z.string(), z.object({ selected: z.boolean(), hash: z.string() })),
})

export type PublishState = z.infer<typeof publishStateSchema>

export const EMPTY_PUBLISH_STATE: PublishState = { version: 0, items: {} }

export const publishStateFile = (args: { atlasHome: string }): string =>
  join(args.atlasHome, PUSH_DIRECTORY_NAME, LAST_PUSH_FILE_NAME)

export async function loadPublishState(args: { atlasHome: string }): Promise<PublishState> {
  try {
    const text = await readFile(publishStateFile(args), 'utf8')
    const parsed = publishStateSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : EMPTY_PUBLISH_STATE
  } catch {
    return EMPTY_PUBLISH_STATE
  }
}

export async function savePublishState(args: { atlasHome: string; state: PublishState }): Promise<void> {
  await writeFileAtomically({
    path: publishStateFile(args),
    content: `${JSON.stringify(args.state, null, 2)}\n`,
  })
}
