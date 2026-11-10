export type HelperPlist = { path: string; contents: string }

export type HelperPlistsDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'write'; plists: HelperPlist[] }

const BUNDLE_SUFFIX = '.app'
const INFO_DICTIONARY_VERSION = '6.0'

export function executableOf({ bundle }: { bundle: string }): string {
  return bundle.endsWith(BUNDLE_SUFFIX) ? bundle.slice(0, -BUNDLE_SUFFIX.length) : bundle
}

function slugOf({ name }: { name: string }): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function plistOf({ executable, identifier }: { executable: string; identifier: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleExecutable</key>
\t<string>${executable}</string>
\t<key>CFBundleIdentifier</key>
\t<string>${identifier}</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>${INFO_DICTIONARY_VERSION}</string>
\t<key>CFBundleName</key>
\t<string>${executable}</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>LSUIElement</key>
\t<true/>
</dict>
</plist>
`
}

export function planHelperPlists({
  os,
  wrapperPath,
  appIdentifier,
  helperBundles,
}: {
  os: string | undefined
  wrapperPath: string | undefined
  appIdentifier: string | undefined
  helperBundles: readonly string[]
}): HelperPlistsDecision {
  if (os !== 'macos')
    return { kind: 'skip', reason: `ELECTROBUN_OS is ${os ?? 'unset'}, not macos` }
  if (!wrapperPath) return { kind: 'skip', reason: 'ELECTROBUN_WRAPPER_BUNDLE_PATH is unset' }
  if (!appIdentifier || appIdentifier.trim() === '')
    return { kind: 'skip', reason: 'ELECTROBUN_APP_IDENTIFIER is unset' }
  if (helperBundles.length === 0)
    return { kind: 'skip', reason: 'the wrapper carries no helper apps' }
  const frameworks = `${wrapperPath.replace(/\/+$/, '')}/Contents/Frameworks`
  return {
    kind: 'write',
    plists: helperBundles.map((bundle) => {
      const executable = executableOf({ bundle })
      return {
        path: `${frameworks}/${bundle}/Contents/Info.plist`,
        contents: plistOf({
          executable,
          identifier: `${appIdentifier}.${slugOf({ name: executable })}`,
        }),
      }
    }),
  }
}
