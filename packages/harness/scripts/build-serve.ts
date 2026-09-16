import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const RIPGREP_PLATFORMS: Readonly<Record<string, string>> = {
  'bun-darwin-arm64': 'darwin-arm64',
  'bun-darwin-x64': 'darwin-x64',
  'bun-linux-x64': 'linux-x64',
  'bun-linux-arm64': 'linux-arm64',
}

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const requireFromHarness = createRequire(join(import.meta.dir, '..', 'package.json'))

async function stageVendoredRipgrep(args: { target: string | undefined }): Promise<string> {
  const platform =
    args.target === undefined ? `${process.platform}-${process.arch}` : RIPGREP_PLATFORMS[args.target]
  if (platform === undefined) {
    throw new Error(`no vendored ripgrep for build target ${args.target}`)
  }

  const requireFromRipgrep = createRequire(requireFromHarness.resolve('@vscode/ripgrep'))
  let binary: string
  try {
    binary = requireFromRipgrep.resolve(`@vscode/ripgrep-${platform}/bin/rg`)
  } catch {
    throw new Error(
      `@vscode/ripgrep-${platform} is not installed; run \`bun install --os='*' --cpu='*'\` to fetch ripgrep for every build target`,
    )
  }

  const manifestPath = join(dirname(dirname(requireFromHarness.resolve('@vscode/ripgrep'))), 'package.json')
  const { version } = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string }

  const vendor = join(import.meta.dir, '..', 'src', 'execution', 'vendor')
  await mkdir(vendor, { recursive: true })
  const staged = join(vendor, 'rg')
  await copyFile(binary, staged)
  await chmod(staged, 0o755)
  return version
}

const target = arg('--target')
const version = await stageVendoredRipgrep({ target })

const cmd = [
  'bun',
  'build',
  '--compile',
  '--define',
  `ATLAS_VENDORED_RG_VERSION:${JSON.stringify(version)}`,
  ...(target === undefined ? [] : ['--target', target]),
  'src/serve/main.ts',
  '--outfile',
  arg('--outfile') ?? 'bin/atlas-serve',
]

const build = Bun.spawnSync({ cmd, cwd: join(import.meta.dir, '..'), stdout: 'inherit', stderr: 'inherit' })
process.exit(build.exitCode)
