import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const APP_NAME = 'CefPaneSpike'
const BUNDLE_ID = 'dev.atlas.spike.cef-pane'
const EXECUTABLE = APP_NAME
const ZIPPED = `${APP_NAME}-mac-arm64.zip`

const HELPERS = [
  { name: '', id: '' },
  { name: ' (GPU)', id: '.gpu' },
  { name: ' (Renderer)', id: '.renderer' },
  { name: ' (Alerts)', id: '.alerts' },
]

const root = join(import.meta.dir, '..')
const binary = join(root, '.build', 'release', EXECUTABLE)
const framework = join(root, '.cef', 'Release', 'Chromium Embedded Framework.framework')
const staging = join(root, '.build', 'cef-spike')
const bundle = join(staging, `${APP_NAME}.app`)
const zipPath = join(staging, ZIPPED)

function infoPlist(fields: Record<string, string | boolean>): string {
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

function run(command: string[], label: string): string {
  const result = Bun.spawnSync(command)
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
  if (result.exitCode !== 0) throw new Error(`${label} failed (${result.exitCode}): ${output}`)
  return output
}

async function mainPlist(): Promise<string> {
  return infoPlist({
    CFBundleDisplayName: 'CEF Pane Spike',
    CFBundleExecutable: EXECUTABLE,
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleName: APP_NAME,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '0.0.1',
    CFBundleVersion: '1',
    LSMinimumSystemVersion: '13.0',
    NSHighResolutionCapable: true,
    NSPrincipalClass: 'NSApplication',
  })
}

async function helperPlist(suffix: string, idSuffix: string): Promise<string> {
  return infoPlist({
    CFBundleExecutable: `${APP_NAME} Helper${suffix}`,
    CFBundleIdentifier: `${BUNDLE_ID}.helper${idSuffix}`,
    CFBundleName: `${APP_NAME} Helper${suffix}`,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: '0.0.1',
    CFBundleVersion: '1',
    LSMinimumSystemVersion: '13.0',
    LSUIElement: true,
    NSHighResolutionCapable: true,
  })
}

async function assembly(): Promise<void> {
  if (!existsSync(binary))
    throw new Error(`missing ${binary}; run swift build -c release --package-path apps/mac/swift`)
  if (!existsSync(framework))
    throw new Error(`missing ${framework}; run bun apps/mac/swift/scripts/fetch-cef.ts`)

  await rm(staging, { recursive: true, force: true })
  await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true })
  await mkdir(join(bundle, 'Contents', 'Frameworks'), { recursive: true })
  await cp(binary, join(bundle, 'Contents', 'MacOS', EXECUTABLE))
  await chmod(join(bundle, 'Contents', 'MacOS', EXECUTABLE), 0o755)
  await writeFile(join(bundle, 'Contents', 'Info.plist'), await mainPlist())
  run(
    [
      'ditto',
      framework,
      join(bundle, 'Contents', 'Frameworks', 'Chromium Embedded Framework.framework'),
    ],
    'copy framework',
  )

  for (const helper of HELPERS) {
    const name = `${APP_NAME} Helper${helper.name}`
    const helperBundle = join(bundle, 'Contents', 'Frameworks', `${name}.app`)
    await mkdir(join(helperBundle, 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(helperBundle, 'Contents', 'Frameworks'), { recursive: true })
    await cp(binary, join(helperBundle, 'Contents', 'MacOS', name))
    await chmod(join(helperBundle, 'Contents', 'MacOS', name), 0o755)
    await writeFile(
      join(helperBundle, 'Contents', 'Info.plist'),
      await helperPlist(helper.name, helper.id),
    )
    await symlink(
      '../../../Chromium Embedded Framework.framework',
      join(helperBundle, 'Contents', 'Frameworks', 'Chromium Embedded Framework.framework'),
    )
  }
}

// Chromium validates that nested framework code is signed, so the framework and each helper are signed before the app.
async function sign(): Promise<void> {
  const frameworks = join(bundle, 'Contents', 'Frameworks')
  run(
    [
      'codesign',
      '--force',
      '--sign',
      '-',
      join(frameworks, 'Chromium Embedded Framework.framework'),
    ],
    'sign framework',
  )
  for (const helper of HELPERS) {
    const name = `${APP_NAME} Helper${helper.name}`
    run(
      ['codesign', '--force', '--deep', '--sign', '-', join(frameworks, `${name}.app`)],
      `sign ${name}`,
    )
  }
  run(['codesign', '--force', '--sign', '-', bundle], 'sign app')
}

async function archive(): Promise<number> {
  await rm(zipPath, { force: true })
  run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zipPath], 'zip bundle')
  const info = await stat(zipPath)
  return info.size
}

async function main(): Promise<void> {
  await assembly()
  await sign()
  const verify = run(
    ['codesign', '--verify', '--deep', '--strict', '--verbose=2', bundle],
    'codesign verify',
  )
  console.log(`codesign --verify --deep --strict: ok\n${verify}`.trim())
  const bytes = await archive()
  console.log(`bundle: ${bundle}`)
  console.log(`zip:    ${zipPath}`)
  console.log(`size:   ${(bytes / 1024 / 1024).toFixed(1)} MiB`)
}

if (import.meta.main) {
  await main()
}
