import { formatSemver, parseSemver } from '@dltech/atlas-core'

export const LAST_LAUNCHED_FILENAME = 'last-launched'

export function lastLaunchedPathFor(atlasHome: string): string {
  return `${atlasHome}/${LAST_LAUNCHED_FILENAME}`
}

export async function readLastLaunched(path: string): Promise<string | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return null

  try {
    const parsed = parseSemver((await file.text()).trim())
    return parsed === null ? null : formatSemver(parsed)
  } catch {
    return null
  }
}

export async function writeLastLaunched(args: { path: string; version: string }): Promise<void> {
  const parsed = parseSemver(args.version)
  if (parsed === null) return

  try {
    await Bun.write(args.path, `${formatSemver(parsed)}\n`)
  } catch {
    // A state file that can't be written just re-shows the notes next launch — never fatal.
  }
}
