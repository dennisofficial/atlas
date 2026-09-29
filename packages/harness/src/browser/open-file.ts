import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export enum EEditor {
  Default = 'default',
  Cursor = 'cursor',
  Code = 'code',
  Zed = 'zed',
  Warp = 'warp',
}

export type FileOpener = (target: { path: string; line?: number }) => void

export type EditorLaunch = { command: string; args: readonly string[] }

const MAC_CLI_PATHS: Partial<Record<EEditor, string>> = {
  [EEditor.Cursor]: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
  [EEditor.Code]: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  [EEditor.Zed]: '/Applications/Zed.app/Contents/MacOS/cli',
}

const WARP_APP_PATH = '/Applications/Warp.app'

const defaultWhich = (bin: string): boolean => Bun.which(bin) !== null

export function detectInstalledEditors(args: {
  platform?: string
  which?: (bin: string) => boolean
} = {}): EEditor[] {
  const platform = args.platform ?? process.platform
  const which = args.which ?? defaultWhich
  const installed: EEditor[] = []

  for (const [editor, macPath] of Object.entries(MAC_CLI_PATHS) as [EEditor, string][]) {
    if (which(editor)) {
      installed.push(editor)
      continue
    }
    if (platform === 'darwin' && existsSync(macPath)) installed.push(editor)
  }

  if (platform === 'darwin' && existsSync(WARP_APP_PATH)) installed.push(EEditor.Warp)

  return installed
}

export function editorLaunch(args: {
  editor: EEditor
  platform?: string
  path: string
  line?: number
}): EditorLaunch {
  const platform = args.platform ?? process.platform
  const atLine = args.line === undefined ? args.path : `${args.path}:${args.line}`

  switch (args.editor) {
    case EEditor.Cursor:
      return { command: 'cursor', args: ['-g', atLine] }
    case EEditor.Code:
      return { command: 'code', args: ['-g', atLine] }
    case EEditor.Zed:
      return { command: 'zed', args: [atLine] }
    case EEditor.Warp:
      // Warp has no CLI flag for opening a path; warp://action/new_tab?path= is its
      // documented URI scheme (warpdotdev/Warp discussions, e.g. #612).
      if (platform === 'darwin') {
        return { command: 'open', args: [`warp://action/new_tab?path=${args.path}`] }
      }
      return osLaunch({ platform, path: args.path })
    default:
      return osLaunch({ platform, path: args.path })
  }
}

function osLaunch(args: { platform: string; path: string }): EditorLaunch {
  if (args.platform === 'darwin') return { command: 'open', args: [args.path] }
  if (args.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', args.path] }
  return { command: 'xdg-open', args: [args.path] }
}

export function createFileOpener(args: { editor: () => EEditor; platform?: string }): FileOpener {
  const platform = args.platform ?? process.platform

  return (target) => {
    const launch = editorLaunch(
      target.line === undefined
        ? { editor: args.editor(), platform, path: target.path }
        : { editor: args.editor(), platform, path: target.path, line: target.line },
    )
    const launched = spawn(launch.command, [...launch.args], { stdio: 'ignore', detached: true })
    launched.on('error', () => undefined)
    launched.unref()
  }
}
