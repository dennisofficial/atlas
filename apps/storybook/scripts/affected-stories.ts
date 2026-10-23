export enum EStorybookPath {
  Root = 'apps/storybook/',
  Config = 'apps/storybook/.storybook/',
  Package = 'apps/storybook/package.json',
  Scripts = 'apps/storybook/scripts/',
  Preview = '.storybook/preview.tsx',
  UiRoot = 'packages/ui/',
  UiPackage = 'packages/ui/package.json',
  Lockfile = 'bun.lock',
}

export enum EIndexEntryType {
  Story = 'story',
  Docs = 'docs',
}

const ROOT_TO_REPO = '../../'
const STYLESHEET_SUFFIX = '.css'

export interface PreviewStats {
  modules: { id: string; reasons?: { moduleName?: string }[] }[]
}

export interface StoryIndex {
  entries: Record<string, { id: string; importPath: string; type: EIndexEntryType | string }>
}

export interface AffectedSelection {
  renderAll: boolean
  storyIds: string[]
  reason: string
}

export interface SelectAffectedStoriesParams {
  stats: PreviewStats
  index: StoryIndex
  changedFiles: string[]
}

function normalizeModuleId(id: string): string {
  return id.startsWith('./') ? id.slice(2) : id
}

function toStorybookRelative(repoPath: string): string {
  if (repoPath.startsWith(EStorybookPath.Root)) return repoPath.slice(EStorybookPath.Root.length)
  return `${ROOT_TO_REPO}${repoPath}`
}

function findGlobalTrigger(changedFiles: string[]): string | undefined {
  return changedFiles.find((file) => {
    if (file.startsWith(EStorybookPath.Config)) return true
    if (file.startsWith(EStorybookPath.Scripts)) return true
    if (file === EStorybookPath.Package) return true
    if (file === EStorybookPath.UiPackage) return true
    if (file === EStorybookPath.Lockfile) return true
    if (!file.endsWith(STYLESHEET_SUFFIX)) return false
    return file.startsWith(EStorybookPath.Root) || file.startsWith(EStorybookPath.UiRoot)
  })
}

function buildImporterMap(stats: PreviewStats): Map<string, Set<string>> {
  const importers = new Map<string, Set<string>>()
  for (const module of stats.modules) {
    const id = normalizeModuleId(module.id)
    const known = importers.get(id) ?? new Set<string>()
    for (const reason of module.reasons ?? []) {
      if (reason.moduleName) known.add(normalizeModuleId(reason.moduleName))
    }
    importers.set(id, known)
  }
  return importers
}

function collectDependents(params: {
  importers: Map<string, Set<string>>
  starts: string[]
}): Set<string> {
  const visited = new Set<string>()
  const queue = params.starts.filter((start) => params.importers.has(start))
  for (const start of queue) visited.add(start)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    if (current === undefined) continue
    for (const importer of params.importers.get(current) ?? []) {
      if (visited.has(importer)) continue
      visited.add(importer)
      queue.push(importer)
    }
  }
  return visited
}

export function selectAffectedStories(params: SelectAffectedStoriesParams): AffectedSelection {
  const trigger = findGlobalTrigger(params.changedFiles)
  if (trigger) return { renderAll: true, storyIds: [], reason: `${trigger} affects every story` }

  const importers = buildImporterMap(params.stats)
  const dependents = collectDependents({
    importers,
    starts: params.changedFiles.map(toStorybookRelative),
  })
  if (dependents.has(EStorybookPath.Preview)) {
    return { renderAll: true, storyIds: [], reason: `a change reaches ${EStorybookPath.Preview}` }
  }

  const storyIds = Object.values(params.index.entries)
    .filter((entry) => entry.type === EIndexEntryType.Story && dependents.has(entry.importPath))
    .map((entry) => entry.id)
  return { renderAll: false, storyIds, reason: `${dependents.size} dependent modules` }
}
