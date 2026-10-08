import { lstat, mkdir, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { TreeEntry } from './capture-files'

const liveTars = new Set<{ kill: () => void }>()
let exitHookArmed = false

const reapOnExit = (tar: { kill: () => void }): void => {
  if (!exitHookArmed) {
    exitHookArmed = true
    process.on('exit', () => {
      for (const live of liveTars) live.kill()
    })
  }
  liveTars.add(tar)
}

const releaseTar = (tar: { kill: () => void }): void => {
  liveTars.delete(tar)
}

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

async function stageMount({ stage, mount }: { stage: string; mount: ArchiveMount }): Promise<string[]> {
  const target = join(stage, mount.mountPath)
  await mkdir(dirname(target), { recursive: true })
  if (mount.entries.length === 0) {
    await mkdir(target)
    return [`${mount.mountPath}/`]
  }
  await symlink(mount.sourcePath, target)
  return mount.entries.map((entry) => `${mount.mountPath}/${entry.path}`)
}

const stillPresent = async ({ stage, name }: { stage: string; name: string }): Promise<boolean> =>
  lstat(join(stage, name)).then(
    () => true,
    () => false,
  )

export async function writeArchive({
  stage,
  looseNames,
  mounts,
  relocated,
  destination,
}: ArchivePlan): Promise<void> {
  const listPath = join(stage, 'archive.list')
  const partial = `${destination}.partial`
  const names: string[] = [...looseNames]
  for (const move of relocated) {
    for (const name of move.names) names.push(`${move.stageDirectory}/${name}`)
  }
  for (const mount of mounts) names.push(...(await stageMount({ stage, mount })))
  const present = await Promise.all(
    names.map(async (name) => ({ name, kept: await stillPresent({ stage, name }) })),
  )
  const kept = present.filter(({ kept: survives }) => survives).map(({ name }) => name)
  await Bun.write(listPath, kept.map((name) => `${name}\0`).join(''))
  await mkdir(dirname(destination), { recursive: true })
  const gnu = await isGnuTar()
  const renames = relocated.flatMap((move) =>
    renameArgs({ gnu, from: move.stageDirectory, to: move.archiveDirectory }),
  )
  try {
    // Pipe tar to `gzip -1` rather than `tar -czf`: the archive is a one-shot transfer artifact
    // (extracted with `tar -xpf`, which is compression-level agnostic), so the fastest level wins
    // ~40% of the capture CPU for a few percent larger bytes. Not a durable format choice.
    const tar = Bun.spawn(
      ['tar', '--no-recursion', '--null', ...renames, '-C', stage, '-T', listPath, '-cf', '-'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      },
    )
    const gzip = Bun.spawn(['gzip', '-1'], {
      stdin: tar.stdout,
      stdout: Bun.file(partial),
      stderr: 'pipe',
    })
    reapOnExit(tar)
    reapOnExit(gzip)
    try {
      const [tarStderr, tarStatus, gzipStderr, gzipStatus] = await Promise.all([
        new Response(tar.stderr).text(),
        tar.exited,
        new Response(gzip.stderr).text(),
        gzip.exited,
      ])
      if (tarStatus !== 0)
        throw new Error(`tar failed while writing ${destination}: ${tarStderr.trim()}`)
      if (gzipStatus !== 0)
        throw new Error(`gzip failed while writing ${destination}: ${gzipStderr.trim()}`)
      await rename(partial, destination)
    } finally {
      releaseTar(tar)
      releaseTar(gzip)
    }
  } finally {
    await rm(partial, { force: true })
  }
}
