import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

import { treeMountPath, writeArchive, type ArchiveMount, type Relocation } from './archive'
import { digestGitAdmin } from './capture-admin'
import { noIgnoreFilter, resolveIgnoreFilter } from './capture-ignore'
import { dropExcludedRootWrappers } from './capture-files'
import { assertPortable, treeSkipRule, walkTree, type TreeEntry } from './capture-files'
import { snapshotWorkspaceTree, type TreeSnapshot } from './capture-fingerprint'
import { discoverLayout, listCapturedWorktrees, type LayoutTree, type WorkspaceLayout } from './capture-layout'
import { stageSharedGit } from './capture-objects'
import { familyManifestOf } from './capture-family'
import {
  absoluteGitDir,
  collectLinkedState,
  collectMainState,
  indexPathIfPresent,
} from './git-state'
import { workspaceManifestSchema, type WorkspaceFamilyCapture, type WorkspaceManifest } from './manifest'

export { fingerprintWorkspaceTree } from './capture-fingerprint'

type Collected = {
  tree: LayoutTree
  files: TreeEntry[]
  state: TreeEntry[]
  stateRoot: string | null
  indexSource: string | null
}

type Observation = { snapshots: TreeSnapshot[]; admin: string | null; paths: string[] }

const isInside = ({ parent, child }: { parent: string; child: string }): boolean =>
  child === parent || child.startsWith(`${parent}${sep}`)

async function assertDestinationOutside({
  destination,
  layout,
}: {
  destination: string
  layout: WorkspaceLayout
}): Promise<string> {
  const absolute = resolve(destination)
  const parent = await realpath(dirname(absolute)).catch(() => dirname(absolute))
  const resolved = join(parent, basename(absolute))
  const guarded = [...layout.trees.map((tree) => tree.sourcePath), ...(layout.commonDir === null ? [] : [layout.commonDir])]
  const clash = guarded.find((root) => isInside({ parent: root, child: resolved }))
  if (clash !== undefined) {
    throw new Error(`Archive destination ${resolved} is inside the captured workspace ${clash}`)
  }
  return resolved
}

async function observe({ layout }: { layout: WorkspaceLayout }): Promise<Observation> {
  const snapshots = await Promise.all(
    layout.trees.map((tree) =>
      snapshotWorkspaceTree({ cwd: tree.sourcePath, excludedRoots: tree.excludedRoots }),
    ),
  )
  const roots = layout.trees.map((tree) => tree.sourcePath)
  const admin = layout.commonDir === null ? null : await digestGitAdmin({ trees: layout.trees })
  return { snapshots, admin, paths: roots }
}

async function collectTree({
  tree,
  layout,
}: {
  tree: LayoutTree
  layout: WorkspaceLayout
}): Promise<Collected> {
  const ignore = layout.commonDir === null ? noIgnoreFilter : await resolveIgnoreFilter({ cwd: tree.sourcePath })
  const siblings =
    layout.commonDir === null
      ? []
      : (await listCapturedWorktrees({ cwd: tree.sourcePath }))
          .map((worktree) => worktree.path)
          .filter((path) => path !== tree.sourcePath)
  const excludedRoots = [...tree.excludedRoots, ...siblings]
  const walk = await walkTree({
    root: tree.sourcePath,
    isSkipped: treeSkipRule({
      root: tree.sourcePath,
      excludedRoots,
      isCaptured: ignore.isCaptured,
      isCapturedDir: ignore.isCapturedDir,
    }),
  })
  assertPortable({ unportable: walk.unportable, label: tree.sourcePath })
  const files = dropExcludedRootWrappers({ entries: walk.entries, root: tree.sourcePath, excludedRoots })
  if (layout.commonDir === null) {
    return { tree, files, state: [], stateRoot: null, indexSource: null }
  }
  const gitDir = await realpath(await absoluteGitDir({ cwd: tree.sourcePath }))
  const state = tree.isMain ? await collectMainState({ gitDir }) : await collectLinkedState({ gitDir })
  assertPortable({ unportable: state.unportable, label: gitDir })
  return {
    tree,
    files,
    state: state.entries,
    stateRoot: gitDir,
    indexSource: await indexPathIfPresent({ gitDir }),
  }
}

function manifestFor({
  layout,
  observed,
}: {
  layout: WorkspaceLayout
  observed: Observation
}): WorkspaceManifest {
  const trees = layout.trees.map((tree) => ({ id: tree.id, sourcePath: tree.sourcePath, isMain: layout.trees.length === 1 ? true : tree.isMain }))
  return workspaceManifestSchema.parse({
    ...(layout.family === null ? {} : { family: familyManifestOf({ family: layout.family, trees, plain: layout.commonDir === null }) }),
    version: 1,
    repository: layout.repository,
    activeId: layout.activeId,
    activeRelativePath: layout.activeRelativePath,
    trees: layout.trees.map(({ excludedRoots: _excluded, ...tree }, index) => ({
      ...tree,
      isMain: layout.trees.length === 1 ? true : tree.isMain,
      head: layout.commonDir === null ? tree.head : (observed.snapshots[index]?.head ?? null),
      branch: layout.commonDir === null ? tree.branch : (observed.snapshots[index]?.branch ?? null),
      fingerprint: observed.snapshots[index]?.fingerprint,
    })),
  })
}

async function stageAndPack({
  stage,
  layout,
  collected,
  manifest,
  destination,
}: {
  stage: string
  layout: WorkspaceLayout
  collected: readonly Collected[]
  manifest: WorkspaceManifest
  destination: string
}): Promise<void> {
  const mounts: ArchiveMount[] = []
  const relocated: Relocation[] = []
  if (layout.commonDir !== null) {
    const shared = await stageSharedGit({
      stage,
      layout,
      commonDir: layout.commonDir,
      stateRoots: collected.flatMap((item) => (item.stateRoot === null ? [] : [item.stateRoot])),
    })
    mounts.push(...shared.mounts)
    relocated.push(...shared.relocated)
  }
  const looseNames: string[] = ['manifest.json']
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  for (const item of collected) {
    const { id } = item.tree
    mounts.push({
      mountPath: treeMountPath({ id, part: 'files' }),
      sourcePath: item.tree.sourcePath,
      entries: item.files,
    })
    if (item.stateRoot !== null) {
      mounts.push({
        mountPath: treeMountPath({ id, part: 'git-state' }),
        sourcePath: item.stateRoot,
        entries: item.state,
      })
    }
    if (item.indexSource !== null) {
      const indexName = treeMountPath({ id, part: 'index' })
      await mkdir(dirname(join(stage, indexName)), { recursive: true })
      await copyFile(item.indexSource, join(stage, indexName))
      looseNames.push(indexName)
    }
  }

  await writeArchive({ stage, looseNames, mounts, relocated, destination })
}

const changedTree = ({
  layout,
  before,
  after,
}: {
  layout: WorkspaceLayout
  before: Observation
  after: Observation
}): string | null => {
  const index = layout.trees.findIndex(
    (_tree, position) =>
      before.snapshots[position]?.fingerprint !== after.snapshots[position]?.fingerprint ||
      before.snapshots[position]?.head !== after.snapshots[position]?.head ||
      before.snapshots[position]?.branch !== after.snapshots[position]?.branch,
  )
  if (index >= 0) return layout.trees[index]?.sourcePath ?? null
  if (before.admin !== after.admin) return layout.commonDir
  return null
}

export async function captureWorkspaceArchive({
  cwd,
  destination,
  family,
}: {
  cwd: string
  destination: string
  family?: WorkspaceFamilyCapture | undefined
}): Promise<WorkspaceManifest> {
  const layout = await discoverLayout({ cwd, family })
  const target = await assertDestinationOutside({ destination, layout })
  const before = await observe({ layout })
  const collected = await Promise.all(layout.trees.map((tree) => collectTree({ tree, layout })))
  const manifest = manifestFor({ layout, observed: before })

  const stage = await mkdtemp(join(tmpdir(), 'atlas-capture-stage-'))
  try {
    await stageAndPack({ stage, layout, collected, manifest, destination: target })
    const after = await observe({ layout })
    const moved = changedTree({ layout, before, after })
    const relisted = await discoverLayout({ cwd, family })
    const sameTrees = relisted.trees.map((tree) => tree.sourcePath).join('\0') === layout.trees.map((tree) => tree.sourcePath).join('\0')
    if (moved !== null || !sameTrees) {
      await rm(target, { force: true })
      throw new Error(`Workspace ${moved ?? layout.repository?.sourcePath ?? cwd} changed while it was being captured; retry once it is quiet`)
    }
    return manifest
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
