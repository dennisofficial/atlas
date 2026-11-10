import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { planHelperPlists } from './helper-plists-plan'

const BUNDLE_SUFFIX = '.app'

function helperBundlesOf({ wrapperPath }: { wrapperPath: string | undefined }): string[] {
  if (wrapperPath === undefined) return []
  const frameworks = join(wrapperPath, 'Contents', 'Frameworks')
  if (!existsSync(frameworks)) return []
  return readdirSync(frameworks).filter((entry) => entry.endsWith(BUNDLE_SUFFIX))
}

export function applyHelperPlists(): void {
  const wrapperPath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH
  const decision = planHelperPlists({
    os: process.env.ELECTROBUN_OS,
    wrapperPath,
    appIdentifier: process.env.ELECTROBUN_APP_IDENTIFIER,
    helperBundles: helperBundlesOf({ wrapperPath }),
  })
  if (decision.kind === 'skip') {
    console.log(`helper-plists: skipped (${decision.reason})`)
    return
  }
  for (const plist of decision.plists) writeFileSync(plist.path, plist.contents)
  console.log(`helper-plists: wrote ${decision.plists.length} helper Info.plist files`)
}
