import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

declare const ATLAS_VENDORED_RG_VERSION: string | undefined

const versionStamp = (): string =>
  typeof ATLAS_VENDORED_RG_VERSION === 'undefined' ? 'dev' : ATLAS_VENDORED_RG_VERSION

let resolved: string | null | undefined

export async function vendoredRipgrep(): Promise<string | null> {
  if (resolved !== undefined) return resolved
  resolved = await resolveVendoredRipgrep()
  return resolved
}

async function resolveVendoredRipgrep(): Promise<string | null> {
  const installed = await installedRipgrepPath()
  if (installed !== null) return installed
  return await materializeEmbeddedRipgrep()
}

async function installedRipgrepPath(): Promise<string | null> {
  try {
    const { rgPath } = await import('@vscode/ripgrep')
    const present = await stat(rgPath).catch(() => null)
    return present === null ? null : rgPath
  } catch {
    return null
  }
}

/**
 * scripts/build.ts stages the compile target's rg beside this module (execution/vendor/rg), where
 * `bun build --compile` embeds it; the import then resolves into /$bunfs/, which cannot be exec'd,
 * so the bytes are copied onto the real filesystem and made executable on first use.
 */
async function materializeEmbeddedRipgrep(): Promise<string | null> {
  try {
    const embedded: { default: string } = await import('./vendor/rg' as string, { with: { type: 'file' } })
    const bytes = await Bun.file(embedded.default).arrayBuffer()

    const directory = join(tmpdir(), `atlas-${process.getuid?.() ?? 'user'}-bin`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const target = join(directory, `rg-${versionStamp()}`)
    if ((await stat(target).catch(() => null)) !== null) return target

    const staging = join(directory, `.rg-${process.pid}`)
    await writeFile(staging, Buffer.from(bytes))
    await chmod(staging, 0o755)
    await rename(staging, target)
    return target
  } catch {
    return null
  }
}
