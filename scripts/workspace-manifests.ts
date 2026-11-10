import type { WorkspaceManifest } from '../packages/core/src/version/release-affected'

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

export function run(cmd: readonly string[]): string {
  const proc = Bun.spawnSync({ cmd: [...cmd], stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.join(' ')} exited ${proc.exitCode}: ${proc.stderr.toString()}`)
  }
  return proc.stdout.toString()
}

export function nonEmptyLines(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function manifestAt(args: { dir: string; json: unknown }): WorkspaceManifest | null {
  const { json } = args
  if (typeof json !== 'object' || json === null) return null
  if (!('name' in json) || typeof json.name !== 'string') return null

  const dependencies = DEPENDENCY_FIELDS.flatMap((field) => {
    if (!(field in json)) return []
    const value: unknown = Reflect.get(json, field)
    return typeof value === 'object' && value !== null ? Object.keys(value) : []
  })
  return { dir: args.dir, name: json.name, dependencies }
}

export async function workspaceManifests(): Promise<readonly WorkspaceManifest[]> {
  const paths = nonEmptyLines(
    run(['git', 'ls-files', 'apps/*/package.json', 'packages/*/package.json']),
  )
  const manifests = await Promise.all(
    paths.map(async (path) =>
      manifestAt({
        dir: path.slice(0, -'/package.json'.length),
        json: await Bun.file(path).json(),
      }),
    ),
  )
  return manifests.filter((manifest) => manifest !== null)
}
