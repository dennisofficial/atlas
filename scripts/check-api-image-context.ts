export const API_IMAGE_IGNORE_PATH = 'apps/api/docker/Dockerfile.dockerignore'
export const API_IMAGE_ROOTS: readonly string[] = ['@dltech/atlas-api', '@dltech/atlas-daemon']

const WORKSPACE_GLOB = new Bun.Glob('{apps,packages,plugins}/*/package.json')
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

export type ImageWorkspace = { dir: string; name: string; dependencies: readonly string[] }

function excludedWorkspaceDirsOf(ignoreLines: readonly string[]): readonly string[] {
  return ignoreLines.flatMap((line) => {
    const match = /^([a-z0-9-]+\/[a-z0-9-]+)\/\*$/.exec(line.trim())
    return match?.[1] === undefined ? [] : [match[1]]
  })
}

function closureOf(args: {
  roots: readonly string[]
  workspaces: readonly ImageWorkspace[]
}): readonly ImageWorkspace[] {
  const byName = new Map(args.workspaces.map((workspace) => [workspace.name, workspace]))
  const reached = new Map<string, ImageWorkspace>()
  const pending = [...args.roots]
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const workspace = byName.get(name)
    if (workspace === undefined || reached.has(name)) continue
    reached.set(name, workspace)
    pending.push(...workspace.dependencies)
  }
  return [...reached.values()]
}

export function apiImageContextProblems(args: {
  ignoreLines: readonly string[]
  workspaces: readonly ImageWorkspace[]
}): readonly string[] {
  const lines = args.ignoreLines.map((line) => line.trim())
  const excluded = excludedWorkspaceDirsOf(lines)
  const closure = closureOf({ roots: API_IMAGE_ROOTS, workspaces: args.workspaces })
  const missingManifests = excluded
    .filter((dir) => !lines.includes(`!${dir}/package.json`))
    .map(
      (dir) =>
        `${dir}/* has no !${dir}/package.json, so the filtered bun install sees a different workspace set`,
    )
  const neededButExcluded = closure
    .filter((workspace) => excluded.includes(workspace.dir))
    .map((workspace) => `${workspace.dir} (${workspace.name}) is in the API image but excluded`)
  return [...missingManifests, ...neededButExcluded]
}

async function readWorkspaces(): Promise<readonly ImageWorkspace[]> {
  const paths = [...WORKSPACE_GLOB.scanSync('.'), 'commands/package.json']
  return Promise.all(
    paths.map(async (path) => {
      const json: Record<string, unknown> = await Bun.file(path).json()
      const dependencies = DEPENDENCY_FIELDS.flatMap((field) => {
        const value = json[field]
        return typeof value === 'object' && value !== null ? Object.keys(value) : []
      })
      return { dir: path.slice(0, -'/package.json'.length), name: String(json.name), dependencies }
    }),
  )
}

async function main(): Promise<void> {
  const ignoreLines = (await Bun.file(API_IMAGE_IGNORE_PATH).text()).split('\n')
  const problems = apiImageContextProblems({ ignoreLines, workspaces: await readWorkspaces() })
  for (const problem of problems) console.error(`api image context: ${problem}`)
  if (problems.length > 0) process.exit(1)
  console.log('api image context: every workspace the API and daemon need is in the build context')
}

if (import.meta.main) await main()
