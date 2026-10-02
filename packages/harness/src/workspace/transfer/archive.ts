import { mkdir, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { TreeEntry } from './capture-files'

export type ArchiveMount = {
  mountPath: string
  sourcePath: string
  entries: readonly TreeEntry[]
}

export type Relocation = { stageDirectory: string; archiveDirectory: string; names: readonly string[] }

export type ArchivePlan = {
  stage: string
  looseNames: readonly string[]
  mounts: readonly ArchiveMount[]
  relocated: readonly Relocation[]
  destination: string
}

export const treeMountPath = ({ id, part }: { id: string; part: 'files' | 'git-state' | 'index' }): string =>
  `trees/${id}/${part}`

const isGnuTar = async (): Promise<boolean> => {
  const probe = Bun.spawn(['tar', '--version'], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
  const [text] = await Promise.all([new Response(probe.stdout).text(), probe.exited])
  return text.includes('GNU tar')
}

const renameArgs = ({ gnu, from, to }: { gnu: boolean; from: string; to: string }): string[] =>
  gnu ? ['--transform', `s,^${from}/,${to}/,`] : ['-s', `,^${from}/,${to}/,`]

async function stageMount({
  stage,
  mount,
  list,
}: {
  stage: string
  mount: ArchiveMount
  list: { write: (text: string) => unknown }
}): Promise<void> {
  const target = join(stage, mount.mountPath)
  await mkdir(dirname(target), { recursive: true })
  if (mount.entries.length === 0) {
    await mkdir(target)
    list.write(`${mount.mountPath}/\0`)
    return
  }
  await symlink(mount.sourcePath, target)
  for (const entry of mount.entries) list.write(`${mount.mountPath}/${entry.path}\0`)
}

export async function writeArchive({
  stage,
  looseNames,
  mounts,
  relocated,
  destination,
}: ArchivePlan): Promise<void> {
  const listPath = join(stage, 'archive.list')
  const partial = `${destination}.partial`
  const list = Bun.file(listPath).writer()
  for (const name of looseNames) list.write(`${name}\0`)
  for (const move of relocated) {
    for (const name of move.names) list.write(`${move.stageDirectory}/${name}\0`)
  }
  for (const mount of mounts) await stageMount({ stage, mount, list })
  await list.end()
  await mkdir(dirname(destination), { recursive: true })
  const gnu = await isGnuTar()
  const renames = relocated.flatMap((move) =>
    renameArgs({ gnu, from: move.stageDirectory, to: move.archiveDirectory }),
  )
  try {
    const tar = Bun.spawn(
      ['tar', '--no-recursion', '--null', ...renames, '-C', stage, '-T', listPath, '-czf', partial],
      {
        stdout: 'ignore',
        stderr: 'pipe',
        stdin: 'ignore',
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      },
    )
    const [stderr, status] = await Promise.all([new Response(tar.stderr).text(), tar.exited])
    if (status !== 0) throw new Error(`tar failed while writing ${destination}: ${stderr.trim()}`)
    await rename(partial, destination)
  } finally {
    await rm(partial, { force: true })
  }
}
