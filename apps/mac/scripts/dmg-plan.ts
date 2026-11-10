import { posix } from 'node:path'

import { CEF_HELPERS, SHELL_NAME, bundlePaths, helperPath } from './pack-shell-plan'

export type SigningEnv = {
  identity: string
  apiKeyPath: string
  apiKeyId: string
  apiIssuer: string
}

export function readSigningEnv({
  env,
}: {
  env: Record<string, string | undefined>
}): SigningEnv | null {
  if (env.ATLAS_MAC_UNSIGNED === '1') return null
  const identity = env.ELECTROBUN_DEVELOPER_ID
  const apiKeyPath = env.ELECTROBUN_APPLEAPIKEYPATH
  const apiKeyId = env.ELECTROBUN_APPLEAPIKEY
  const apiIssuer = env.ELECTROBUN_APPLEAPIISSUER
  if (!identity || !apiKeyPath || !apiKeyId || !apiIssuer) return null
  return { identity, apiKeyPath, apiKeyId, apiIssuer }
}

export const CHANNEL = 'stable'
export const PLATFORM = 'macos-arm64'
export const PRODUCT_NAME = 'Atlas'
export const APP_BUNDLE_NAME = `${PRODUCT_NAME}.app`
export const ENTITLEMENTS = posix.join('assets', 'entitlements.plist')

export const WINDOW = { width: 660, height: 400 } as const
export const APP_ICON_POSITION = { x: 180, y: 200 } as const
export const APPLICATIONS_POSITION = { x: 480, y: 200 } as const

export function buildCreateDmgArgs(params: {
  appName: string
  volumeName: string
  volumeIcon: string
  background: string
  outputPath: string
  sourceDir: string
}): string[] {
  const { appName, volumeName, volumeIcon, background, outputPath, sourceDir } = params
  return [
    '--volname',
    volumeName,
    '--volicon',
    volumeIcon,
    '--background',
    background,
    '--window-pos',
    '200',
    '120',
    '--window-size',
    String(WINDOW.width),
    String(WINDOW.height),
    '--icon-size',
    '100',
    '--text-size',
    '13',
    '--icon',
    appName,
    String(APP_ICON_POSITION.x),
    String(APP_ICON_POSITION.y),
    '--hide-extension',
    appName,
    '--app-drop-link',
    String(APPLICATIONS_POSITION.x),
    String(APPLICATIONS_POSITION.y),
    '--no-internet-enable',
    outputPath,
    sourceDir,
  ]
}

interface DmgNameParams {
  channel: string
  platform: string
  productName: string
}

function assetPrefix({ channel }: { channel: string }): string {
  return channel === '' || channel === CHANNEL ? '' : `${channel}-`
}

// The unversioned name is what the app's download button links to, and GitHub's /releases/latest/download/ needs it to be stable.
export function dmgNameFor({ channel, platform, productName }: DmgNameParams): string {
  return `${assetPrefix({ channel })}${platform}-${productName}.dmg`
}

export function dmgArtifactNameFor({
  channel,
  platform,
  productName,
  version,
}: DmgNameParams & { version: string }): string {
  return `${assetPrefix({ channel })}${platform}-${productName}-${version}.dmg`
}

export interface SignTarget {
  readonly path: string
  readonly deep: boolean
  readonly entitlements: boolean
}

// Chromium refuses to load nested framework code that is unsigned, so the framework and each helper are signed before the app.
export function dmgSignTargets({ appPath }: { appPath: string }): SignTarget[] {
  const paths = bundlePaths({ bundle: appPath, app: SHELL_NAME })
  return [
    { path: paths.framework, deep: false, entitlements: false },
    ...CEF_HELPERS.map((helper) => ({
      path: helperPath({ frameworks: paths.frameworks, app: SHELL_NAME, helper }),
      deep: true,
      entitlements: true,
    })),
    { path: posix.join(paths.contents, 'MacOS', 'bun'), deep: false, entitlements: true },
    { path: appPath, deep: false, entitlements: true },
  ]
}
