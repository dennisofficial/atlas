export const SHIPPED_APP_DIRS: readonly string[] = [
  'apps/tui',
  'apps/serve',
  'apps/mac',
  'apps/web',
]

export type WorkspaceManifest = {
  readonly dir: string
  readonly name: string
  readonly dependencies: readonly string[]
}

const EVERY_APP_ROOT_FILES = new Set([
  'bun.lock',
  'package.json',
  'bunfig.toml',
  'tsconfig.base.json',
])
const EVERY_APP_ROOT_DIRS: readonly string[] = ['patches']
const TEST_OR_STORY_PATH = /(^|\/)__tests__\/|\.(spec|test|stories)\.[cm]?[jt]sx?$/

function isInside(args: { path: string; dir: string }): boolean {
  return args.path.startsWith(`${args.dir}/`)
}

function affectsEveryApp(path: string): boolean {
  if (EVERY_APP_ROOT_FILES.has(path)) return true
  return EVERY_APP_ROOT_DIRS.some((dir) => isInside({ path, dir }))
}

export function isTestOrStoryPath(path: string): boolean {
  return TEST_OR_STORY_PATH.test(path)
}

export function workspaceClosure(args: {
  manifests: readonly WorkspaceManifest[]
  rootDir: string
}): readonly string[] {
  const byName = new Map(args.manifests.map((manifest) => [manifest.name, manifest]))
  const byDir = new Map(args.manifests.map((manifest) => [manifest.dir, manifest]))
  const reached = new Set<string>([args.rootDir])
  const pending = [args.rootDir]

  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const dependency of byDir.get(dir)?.dependencies ?? []) {
      const target = byName.get(dependency)
      if (target === undefined || reached.has(target.dir)) continue
      reached.add(target.dir)
      pending.push(target.dir)
    }
  }

  return [...reached]
}

export function affectedApps(args: {
  manifests: readonly WorkspaceManifest[]
  apps: readonly string[]
  changedPaths: readonly string[]
}): readonly string[] {
  const shippedPaths = args.changedPaths.filter((path) => !isTestOrStoryPath(path))
  if (shippedPaths.some(affectsEveryApp)) return [...args.apps]

  return args.apps.filter((app) => {
    const dirs = workspaceClosure({ manifests: args.manifests, rootDir: app })
    return shippedPaths.some((path) => dirs.some((dir) => isInside({ path, dir })))
  })
}
