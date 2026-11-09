import type { Db, Pool } from '@dltech/atlas-db'
import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire'

import {
  editMemory,
  getMemory,
  listAllMemories,
  listMemories,
  putMemory,
  removeMemory,
  type MemoryKey,
} from '../memories'

export const USER_A = 'user-a'
export const USER_B = 'user-b'
export const PROJECT = 'acme/widgets'

export const globalNote = ({
  name,
  body = 'fact. **Why:** x',
}: {
  name: string
  body?: string
}) => ({
  userId: USER_A,
  scope: EMemoryScope.Global,
  name,
  description: `about ${name}`,
  type: EMemoryType.Reference,
  body,
})

export const memoryOpsOf = (db: Db) => ({
  put: (args: Omit<Parameters<typeof putMemory>[0], 'db'>) => putMemory({ db, ...args }),
  get: (args: MemoryKey) => getMemory({ db, ...args }),
  edit: (args: Omit<Parameters<typeof editMemory>[0], 'db'>) => editMemory({ db, ...args }),
  remove: (args: MemoryKey) => removeMemory({ db, ...args }),
  list: (args: { userId: string; project?: string | undefined }) => listMemories({ db, ...args }),
  listAll: (args: { userId: string }) => listAllMemories({ db, ...args }),
  rowsOf: () =>
    db.orm.public.Memory.where((row) => row.id.neq(''))
      .orderBy((row) => row.createdAt.asc())
      .all(),
  stampInOrder: async (names: string[]) => {
    const base = Date.parse('2026-10-01T00:00:00.000Z')
    for (const [index, name] of names.entries()) {
      await db.orm.public.Memory.where({ name }).updateAndCount({
        updatedAt: new Date(base + index * 1_000),
      })
    }
  },
})

export const waitForBlockedWriter = async (pool: Pool): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE \"Memory\"%'",
    )
    if (waiting.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the guarded update never blocked on the row lock')
}
