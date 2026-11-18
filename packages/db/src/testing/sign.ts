import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const DB_ROOT = join(import.meta.dirname, '..', '..')

export function signDatabase({ url }: { url: string }): void {
  const signed = spawnSync('bunx', ['prisma', 'db', 'sign', '--no-advance-ref'], {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    encoding: 'utf8',
  })
  if (signed.status !== 0) {
    throw new Error(
      `prisma db sign left ${url} unmarked (${signed.status}): ${signed.error?.message ?? ''}\n${signed.stdout}\n${signed.stderr}`,
    )
  }
}
