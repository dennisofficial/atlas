import { posix } from 'node:path'

export const SHELL_NAME = 'AtlasShell'
export const SHELL_IDENTIFIER = 'io.byatlas.mac.shell'
export const CEF_FRAMEWORK = 'Chromium Embedded Framework.framework'
export const WEB_ROOT = 'web-standalone/apps/web'
export const HOST_SCRIPT = 'app/host.js'
export const MINIMUM_MACOS = '14.0'

export interface CefHelper {
  readonly suffix: string
  readonly identifierSuffix: string
}

export const CEF_HELPERS: readonly CefHelper[] = [
  { suffix: '', identifierSuffix: '' },
  { suffix: ' (GPU)', identifierSuffix: '.gpu' },
  { suffix: ' (Renderer)', identifierSuffix: '.renderer' },
  { suffix: ' (Alerts)', identifierSuffix: '.alerts' },
]

export function helperName({ app, helper }: { app: string; helper: CefHelper }): string {
  return `${app} Helper${helper.suffix}`
}

export function helperIdentifier({
  identifier,
  helper,
}: {
  identifier: string
  helper: CefHelper
}): string {
  return `${identifier}.helper${helper.identifierSuffix}`
}

// A helper sits at Contents/Frameworks/<helper>.app/Contents/Frameworks, so the app's framework is three levels up.
export const HELPER_FRAMEWORK_LINK = `../../../${CEF_FRAMEWORK}`

export interface BundlePaths {
  readonly bundle: string
  readonly contents: string
  readonly executable: string
  readonly infoPlist: string
  readonly resources: string
  readonly frameworks: string
  readonly framework: string
  readonly webRoot: string
  readonly webServer: string
  readonly hostScript: string
  readonly helpersRoot: string
}

export function bundlePaths({ bundle, app }: { bundle: string; app: string }): BundlePaths {
  const contents = posix.join(bundle, 'Contents')
  const frameworks = posix.join(contents, 'Frameworks')
  const resources = posix.join(contents, 'Resources')
  return {
    bundle,
    contents,
    executable: posix.join(contents, 'MacOS', app),
    infoPlist: posix.join(contents, 'Info.plist'),
    resources,
    frameworks,
    framework: posix.join(frameworks, CEF_FRAMEWORK),
    webRoot: posix.join(resources, WEB_ROOT),
    webServer: posix.join(resources, WEB_ROOT, 'server.js'),
    hostScript: posix.join(resources, HOST_SCRIPT),
    helpersRoot: frameworks,
  }
}

export function helperPath({
  frameworks,
  app,
  helper,
}: {
  frameworks: string
  app: string
  helper: CefHelper
}): string {
  return posix.join(frameworks, `${helperName({ app, helper })}.app`)
}

export function infoPlist(fields: Record<string, string | boolean>): string {
  const entries = Object.entries(fields)
    .map(([key, value]) =>
      typeof value === 'boolean'
        ? `\t<key>${key}</key>\n\t${value ? '<true/>' : '<false/>'}`
        : `\t<key>${key}</key>\n\t<string>${value}</string>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>
`
}

export function shellInfoPlist({
  identifier,
  version,
}: {
  identifier: string
  version: string
}): string {
  return infoPlist({
    CFBundleDisplayName: 'Atlas',
    CFBundleExecutable: SHELL_NAME,
    CFBundleIdentifier: identifier,
    CFBundleName: SHELL_NAME,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: MINIMUM_MACOS,
    NSHighResolutionCapable: true,
    NSPrincipalClass: 'NSApplication',
  })
}

export function helperInfoPlist({
  app,
  identifier,
  version,
  helper,
}: {
  app: string
  identifier: string
  version: string
  helper: CefHelper
}): string {
  const name = helperName({ app, helper })
  return infoPlist({
    CFBundleExecutable: name,
    CFBundleIdentifier: helperIdentifier({ identifier, helper }),
    CFBundleName: name,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: MINIMUM_MACOS,
    LSUIElement: true,
    NSHighResolutionCapable: true,
  })
}

export interface SignTarget {
  readonly path: string
  readonly deep: boolean
}

// Chromium refuses to load nested framework code that is unsigned, so the framework and each helper are signed before the app.
export function signTargets({ bundle, app }: { bundle: string; app: string }): SignTarget[] {
  const paths = bundlePaths({ bundle, app })
  return [
    { path: paths.framework, deep: false },
    ...CEF_HELPERS.map((helper) => ({
      path: helperPath({ frameworks: paths.frameworks, app, helper }),
      deep: true,
    })),
    { path: bundle, deep: false },
  ]
}
