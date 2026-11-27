import { spawn } from 'node:child_process'

export type UrlLaunch = (url: string) => Promise<boolean>

export type BrowserLaunch = { command: string; args: readonly string[] }

export type Launched = {
  on: (event: 'error' | 'exit', listener: (code: number | null) => void) => void
  unref: () => void
}

export type UrlLauncher = (launch: BrowserLaunch) => Launched

export function browserLaunchOf(args: { platform: string; url: string }): BrowserLaunch {
  if (args.platform === 'darwin') return { command: 'open', args: [args.url] }
  if (args.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', args.url] }
  return { command: 'xdg-open', args: [args.url] }
}

const spawnLaunch: UrlLauncher = (launch) => {
  const child = spawn(launch.command, [...launch.args], { stdio: 'ignore', detached: true })
  return {
    on: (event, listener) => {
      if (event === 'exit') child.on('exit', (code) => listener(code))
      else child.on('error', () => listener(null))
    },
    unref: () => child.unref(),
  }
}

export function createUrlOpener(args: { platform?: string; launch?: UrlLauncher } = {}): UrlLaunch {
  const platform = args.platform ?? process.platform
  const launch = args.launch ?? spawnLaunch
  return (url) =>
    new Promise<boolean>((resolve) => {
      const launched = launch(browserLaunchOf({ platform, url }))
      launched.on('error', () => resolve(false))
      launched.on('exit', (code) => resolve(code === 0))
      launched.unref()
    })
}
