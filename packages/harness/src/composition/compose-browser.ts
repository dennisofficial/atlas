import { choiceValueOf, ESettingId } from '@dltech/atlas-core'

import { createFileOpener, EEditor, type FileOpener } from '../browser/open-file'
import { createUrlOpener, type UrlOpener } from '../browser/open-url'
import { createPathResolver, type PathResolver } from '../browser/path-resolver'
import { FileBrowser } from '../files/file-browser'
import type { SettingsService } from '../settings/service'

import type { ExecutionLocationState } from './execution-location-state'
import { reachableRootsFor } from './reachable-files'

export type BrowserBinding = {
  files: FileBrowser
  openUrl: UrlOpener
  pathResolver: PathResolver
  openFile: FileOpener
}

export function bindBrowser(args: {
  anchor: string
  settings: SettingsService
  executionLocation: ExecutionLocationState
  mounts: readonly string[]
}): BrowserBinding {
  const editor = (): EEditor => {
    const held = choiceValueOf({
      resolution: args.settings.snapshot().resolution,
      id: ESettingId.Editor,
      fallback: EEditor.Default,
    })
    return Object.values(EEditor).find((candidate) => candidate === held) ?? EEditor.Default
  }

  return {
    files: new FileBrowser({
      root: args.anchor,
      reachableRoots: () =>
        reachableRootsFor({
          location: args.executionLocation.current(),
          projectDirectory: args.anchor,
          mounts: args.mounts,
        }),
    }),
    openUrl: createUrlOpener(),
    pathResolver: createPathResolver({ root: args.anchor }),
    openFile: createFileOpener({ editor }),
  }
}
