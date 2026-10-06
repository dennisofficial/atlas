import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { fingerprintWorkspaceTree } from './capture-fingerprint'
import { type RestoredTree, type RestoredWorkspace, type WorkspaceManifest } from './manifest'
import { applyExisting, applyFresh, applyPlain } from './restore-apply'
import { defaultSuffix, DestinationMovedError, planDestination, readReceipt, RECEIPT_NAME } from './restore-destination'
import { plainReceiptPath, writePlainWorkspaceReceipt } from './plain-receipt'
import { canonicalize, isDirectory, remapTexts, rollbackJournal, stashEntry, type Journal } from './restore-files'
import { restoredFamilyOf } from './restore-family'
import { mustGit } from './restore-git'
import { extractWorkspaceArchive, isCaseInsensitive, scanWorkspaceArchive } from './restore-archive'
import {
  EWorkspaceRestoreMode,
  ETreeAction,
  type DestinationPlan,
  type RestoreArgs,
  type RestoreContext,
  type TreeOutcome,
  type WorkspaceRestoration,
} from './restore-types'

export { EWorkspaceRestoreMode, type WorkspaceRestoration } from './restore-types'

const STAGE_PREFIX = '.atlas-restore-'

const mappingOf = ({ manifest, plan }: { manifest: WorkspaceManifest; plan: DestinationPlan }): Map<string, string> => {
  const mapping = new Map<string, string>()
  if (manifest.repository !== null) mapping.set(manifest.repository.sourcePath, plan.anchor)
  for (const item of plan.trees) mapping.set(item.tree.sourcePath, item.path)
  return mapping
}

async function commonDirOf({ plan }: { plan: DestinationPlan }): Promise<string> {
  if (plan.fresh) return join(plan.anchor, '.git')
  const out = await mustGit({ args: ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd: plan.repoCwd })
  return out.trim()
}

async function writeReceipt({
  ctx,
  outcomes,
  mode,
  fingerprints,
}: {
  ctx: RestoreContext
  outcomes: readonly TreeOutcome[]
  mode: EWorkspaceRestoreMode
  fingerprints: ReadonlyMap<string, string>
}): Promise<void> {
  const host = mode === EWorkspaceRestoreMode.Host
  const earlier = await readReceipt({ commonDir: ctx.commonDir })
  const fresh = outcomes.filter(({ planned }) => planned.action !== ETreeAction.Reuse).map(({ planned }) => {
    const id = planned.suffix === null ? planned.tree.id : `${planned.tree.id}-${planned.suffix}`
    return {
      id,
      path: planned.path,
      originPath: host ? planned.path : planned.tree.originPath,
      generation: planned.tree.fingerprint,
      baseline: host ? (fingerprints.get(planned.tree.id) ?? planned.tree.fingerprint) : (planned.tree.baseline ?? planned.tree.fingerprint),
    }
  })
  const kept = (earlier?.trees ?? []).filter((entry) => !fresh.some((item) => item.path === entry.path || item.id === entry.id))
  const origin = ctx.manifest.repository?.originPath ?? ctx.plan.anchor
  const receipt = {
    version: 1,
    repositoryOrigin: host ? ctx.plan.anchor : origin,
    trees: [...kept, ...fresh],
  }
  const path = join(ctx.commonDir, RECEIPT_NAME)
  await stashEntry({ path, key: RECEIPT_NAME, journal: ctx.journal })
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`)
  ctx.journal.undo.push(() => rm(path, { force: true }))
}

async function writePlainReceipt({
  ctx,
  outcome,
  mode,
  fingerprints,
}: {
  ctx: RestoreContext
  outcome: TreeOutcome
  mode: EWorkspaceRestoreMode
  fingerprints: ReadonlyMap<string, string>
}): Promise<void> {
  const { planned } = outcome
  const host = mode === EWorkspaceRestoreMode.Host
  const path = await plainReceiptPath({ root: planned.path })
  await stashEntry({ path, key: 'plain-receipt', journal: ctx.journal })
  await writePlainWorkspaceReceipt({
    path,
    receipt: {
      version: 1,
      treeId: planned.tree.id,
      originPath: host ? planned.path : planned.tree.originPath,
      baseline: host ? (fingerprints.get(planned.tree.id) ?? planned.tree.fingerprint) : (planned.tree.baseline ?? planned.tree.fingerprint),
    },
  })
  ctx.journal.undo.push(() => rm(path, { force: true }))
}

async function verify({ outcomes, pointerMap }: { outcomes: readonly TreeOutcome[]; pointerMap: ReadonlyMap<string, string> }): Promise<Map<string, string>> {
  const fingerprints = new Map<string, string>()
  for (const { planned, branch } of outcomes) {
    const original = planned.tree.branch
    const headRef = original === null ? undefined : `refs/heads/${original}`
    const actual = await fingerprintWorkspaceTree({ cwd: planned.path, headRef: branch === original ? undefined : headRef, pointerMap })
    if (actual !== planned.tree.fingerprint) {
      throw new Error(`restored workspace ${planned.path} does not match the archive; nothing was kept`)
    }
    fingerprints.set(planned.tree.id, await fingerprintWorkspaceTree({ cwd: planned.path }))
  }
  return fingerprints
}

async function assertUntouched({
  outcomes,
  fingerprints,
  stage,
}: {
  outcomes: readonly TreeOutcome[]
  fingerprints: ReadonlyMap<string, string>
  stage: string
}): Promise<void> {
  for (const { planned } of outcomes) {
    if (planned.action === ETreeAction.Reuse) continue
    const expected = fingerprints.get(planned.tree.id)
    const current = await fingerprintWorkspaceTree({ cwd: planned.path }).catch(() => null)
    if (current !== expected) {
      throw new Error(`${planned.path} changed after it was restored, so the restore was not undone; originals are kept in ${stage}`)
    }
  }
}

async function activeDirectory({ manifest, outcomes }: { manifest: WorkspaceManifest; outcomes: readonly TreeOutcome[] }): Promise<string> {
  const active = outcomes.find(({ planned }) => planned.tree.id === manifest.activeId)
  if (active === undefined) throw new Error('archive manifest names an active tree that was not restored')
  const nested = resolve(active.planned.path, manifest.activeRelativePath)
  return (await isDirectory(nested)) ? nested : active.planned.path
}

async function restoredOf({
  outcomes,
  cwd,
  plan,
  manifest,
}: {
  outcomes: readonly TreeOutcome[]
  cwd: string
  plan: DestinationPlan
  manifest: WorkspaceManifest
}): Promise<RestoredWorkspace> {
  const trees: RestoredTree[] = outcomes.map(({ planned, branch, renamedFrom }) => ({
    id: planned.tree.id,
    sourcePath: planned.tree.sourcePath,
    path: planned.path,
    branch,
    renamedFrom,
  }))
  const family = await restoredFamilyOf({ manifest, outcomes })
  return {
    cwd,
    repository: manifest.repository === null ? null : plan.anchor,
    trees,
    ...(family === undefined ? {} : { family }),
  }
}

const REPLAN_LIMIT = 3

async function prepareOnce(args: RestoreArgs): Promise<WorkspaceRestoration> {
  const destination = await canonicalize(resolve(args.destination))
  await mkdir(dirname(destination), { recursive: true })
  const stage = await mkdtemp(join(dirname(destination), STAGE_PREFIX))
  const journal: Journal = { undo: [], backupRoot: join(stage, 'backup') }
  const abandon = async (error: unknown): Promise<never> => {
    const leftover = await rollbackJournal({ journal, stage }).then(() => null, (problem: unknown) => problem)
    if (leftover !== null) throw new AggregateError([error, leftover], `workspace restore failed and could not be fully undone; recovery material is kept in ${stage}`)
    throw error
  }
  try {
    const caseInsensitive = await isCaseInsensitive({ directory: stage })
    const remappable = await scanWorkspaceArchive({ archivePath: args.archivePath, caseInsensitive })
    const extracted = join(stage, 'incoming')
    await mkdir(extracted)
    const manifest = await extractWorkspaceArchive({ archivePath: args.archivePath, stage: extracted })
    const suffix = args.suffix ?? defaultSuffix
    const plan = await planDestination({ manifest, target: destination, mode: args.mode, suffix })
    const commonDir = manifest.repository === null ? '' : await commonDirOf({ plan })
    const ctx: RestoreContext = { extracted, manifest, plan, journal, suffix, commonDir, beforeSweep: args.beforeSweep }
    await remapTexts({ root: extracted, paths: remappable, mapping: mappingOf({ manifest, plan }) })
    const outcomes = manifest.repository === null ? await applyPlain({ ctx }) : plan.fresh ? await applyFresh({ ctx }) : await applyExisting({ ctx })
    const pointerMap = new Map([...mappingOf({ manifest, plan })].map(([source, target]) => [target, source]))
    const fingerprints = await verify({ outcomes, pointerMap })
    const [only] = outcomes
    if (manifest.repository !== null) await writeReceipt({ ctx, outcomes, mode: args.mode, fingerprints })
    else if (only !== undefined) await writePlainReceipt({ ctx, outcome: only, mode: args.mode, fingerprints })
    const cwd = await activeDirectory({ manifest, outcomes })
    return {
      restored: await restoredOf({ outcomes, cwd, plan, manifest }),
      commit: async () => {
        journal.undo.length = 0
        await rm(stage, { recursive: true, force: true })
      },
      rollback: async () => {
        await assertUntouched({ outcomes, fingerprints, stage })
        await rollbackJournal({ journal, stage })
      },
    }
  } catch (error) {
    return abandon(error)
  }
}

export async function prepareWorkspaceRestoration(args: RestoreArgs): Promise<WorkspaceRestoration> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prepareOnce(args)
    } catch (error) {
      if (!(error instanceof DestinationMovedError) || attempt >= REPLAN_LIMIT) throw error
    }
  }
}

export async function restoreWorkspaceArchive(args: RestoreArgs): Promise<RestoredWorkspace> {
  const restoration = await prepareWorkspaceRestoration(args)
  await restoration.commit()
  return restoration.restored
}
