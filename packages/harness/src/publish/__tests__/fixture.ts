import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export type PublishFixture = { atlasHome: string; home: string; cleanup: () => Promise<void> }

export async function makeFixture(files: Readonly<Record<string, string>>): Promise<PublishFixture> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-publish-'))
  const atlasHome = join(root, 'atlas-home')
  const home = join(root, 'home')
  await mkdir(atlasHome, { recursive: true })
  await mkdir(home, { recursive: true })
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return { atlasHome, home, cleanup: () => rm(root, { recursive: true, force: true }) }
}
