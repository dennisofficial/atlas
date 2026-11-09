import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { nodeModulesDirsUnder } from './flatten-web-deps'

// The web app renders no next/image, so Next never loads sharp. Its prebuilt libvips is an
// architecture-specific 37 MB tree that would make the payload unusable on another machine.
const NATIVE_PACKAGES = ['sharp', '@img']

export function dropNativeWebDeps({ root }: { root: string }): string[] {
  const removed: string[] = []
  for (const nodeModules of nodeModulesDirsUnder(root)) {
    for (const name of NATIVE_PACKAGES) {
      const path = join(nodeModules, name)
      if (!existsSync(path)) continue
      rmSync(path, { recursive: true, force: true })
      removed.push(path)
    }
  }
  return removed
}

if (import.meta.main) {
  const root = process.argv[2]
  if (root === undefined) throw new Error('usage: drop-native-web-deps.ts <web-standalone>')
  const removed = dropNativeWebDeps({ root })
  console.log(
    removed.length === 0 ? 'no native web dependencies to drop' : `dropped ${removed.join(', ')}`,
  )
}
