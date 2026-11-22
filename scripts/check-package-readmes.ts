import { auditReadme, type PackageManifest, README_EXEMPT } from './package-readmes/audit'

const PACKAGE_MANIFEST_GLOB = new Bun.Glob('{packages,plugins}/*/package.json')
const COMMANDS_MANIFEST = 'commands/package.json'

const subpathsOf = (exports: unknown): string[] => {
  if (typeof exports === 'string') return ['.']
  if (exports === null || typeof exports !== 'object') return ['.']
  const keys = Object.keys(exports)
  return keys.length === 0 ? ['.'] : keys
}

const manifestAt = async (path: string): Promise<PackageManifest> => {
  const manifest = (await Bun.file(path).json()) as { name: string; exports?: unknown }
  return {
    dir: path.replace(/\/package\.json$/, ''),
    name: manifest.name,
    exports: subpathsOf(manifest.exports),
  }
}

const manifestPaths = async (): Promise<string[]> => {
  const paths = [COMMANDS_MANIFEST]
  for await (const path of PACKAGE_MANIFEST_GLOB.scan({ cwd: '.' })) paths.push(path)
  return paths.sort()
}

const isExempt = (dir: string): boolean => (README_EXEMPT as readonly string[]).includes(dir)

async function main(): Promise<void> {
  const manifests = (await Promise.all((await manifestPaths()).map(manifestAt))).filter(
    (manifest) => !isExempt(manifest.dir),
  )
  let failed = false
  for (const manifest of manifests) {
    const file = Bun.file(`${manifest.dir}/README.md`)
    const readme = (await file.exists()) ? await file.text() : undefined
    for (const problem of auditReadme({ manifest, readme })) {
      console.error(`package readmes: ${manifest.dir}: ${problem}`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  console.log(`package readmes: clean (${manifests.length} packages)`)
}

if (import.meta.main) await main()
