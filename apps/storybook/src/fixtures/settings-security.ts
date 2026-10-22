export enum EDeviceKind {
  Browser = 'browser',
  Cli = 'cli',
  Sandbox = 'sandbox',
}

export type SignedInDevice = {
  id: string
  kind: EDeviceKind
  name: string
  meta: string
  current: boolean
}

export const SIGNED_IN_DEVICES: SignedInDevice[] = [
  {
    id: 'dev_chrome',
    kind: EDeviceKind.Browser,
    name: 'Chrome on macOS',
    meta: '73.162.40.18 · San Francisco, US · Last active now',
    current: true,
  },
  {
    id: 'dev_tui',
    kind: EDeviceKind.Cli,
    name: 'atlas TUI · dennis-mbp',
    meta: '73.162.40.18 · San Francisco, US · Last active 2m ago',
    current: false,
  },
  {
    id: 'dev_safari',
    kind: EDeviceKind.Browser,
    name: 'Safari on iPhone',
    meta: '172.58.12.201 · Oakland, US · Last active 3h ago',
    current: false,
  },
  {
    id: 'dev_serve',
    kind: EDeviceKind.Sandbox,
    name: 'atlas-serve · sandbox sb-1evx',
    meta: 'iad1 · vercel · Last active 12m ago',
    current: false,
  },
  {
    id: 'dev_cli_ci',
    kind: EDeviceKind.Cli,
    name: 'atlas CLI · build-runner-04',
    meta: '34.121.8.77 · Council Bluffs, US · Last active 2d ago',
    current: false,
  },
]
