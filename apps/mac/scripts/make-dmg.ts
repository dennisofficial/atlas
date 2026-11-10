import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  APP_BUNDLE_NAME,
  CHANNEL,
  ENTITLEMENTS,
  PLATFORM,
  PRODUCT_NAME,
  buildCreateDmgArgs,
  dmgArtifactNameFor,
  dmgNameFor,
  dmgSignTargets,
  readSigningEnv,
  type SigningEnv,
} from './dmg-plan'
import { SHELL_NAME } from './pack-shell-plan'

const appRoot = resolve(import.meta.dir, '..')
const assets = join(appRoot, 'assets', 'dmg')
const sourceApp = join(appRoot, 'build', `${SHELL_NAME}.app`)
const artifacts = join(appRoot, 'artifacts')
const entitlementsPath = join(appRoot, ENTITLEMENTS)

function fail(message: string): never {
  console.error(`make-dmg: ${message}`)
  process.exit(1)
}

function run({ cmd }: { cmd: string[] }) {
  console.log(`$ ${cmd.join(' ')}`)
  const result = Bun.spawnSync({ cmd, stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode !== 0) fail(`${cmd[0]} exited with ${result.exitCode}`)
}

function signApp({ app, signing }: { app: string; signing: SigningEnv }) {
  for (const target of dmgSignTargets({ appPath: app })) {
    if (!existsSync(target.path)) fail(`missing signing target ${target.path}`)
    const flags = [
      target.deep ? '--deep' : '',
      ...(target.entitlements ? ['--entitlements', entitlementsPath] : []),
    ].filter((flag) => flag !== '')
    run({
      cmd: [
        'codesign',
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--sign',
        signing.identity,
        ...flags,
        target.path,
      ],
    })
  }
  run({ cmd: ['codesign', '--verify', '--deep', '--strict', '--verbose=2', app] })
}

function signAndNotarize({ dmg, signing }: { dmg: string; signing: SigningEnv }) {
  run({ cmd: ['codesign', '--force', '--sign', signing.identity, '--timestamp', dmg] })
  run({
    cmd: [
      'xcrun',
      'notarytool',
      'submit',
      dmg,
      '--key',
      signing.apiKeyPath,
      '--key-id',
      signing.apiKeyId,
      '--issuer',
      signing.apiIssuer,
      '--wait',
    ],
  })
  run({ cmd: ['xcrun', 'stapler', 'staple', dmg] })
  run({ cmd: ['xcrun', 'stapler', 'validate', dmg] })
}

function report({ names }: { names: string[] }) {
  for (const name of names) {
    const path = join(artifacts, name)
    const mib = statSync(path).size / 1024 / 1024
    console.log(`make-dmg: ${name} (${mib.toFixed(1)} MiB)`)
  }
}

if (process.platform !== 'darwin') {
  fail(
    'requires macOS (hdiutil, create-dmg, codesign, notarytool); run it on a Mac or in the mac-release job',
  )
}
if (!existsSync(sourceApp)) fail(`no ${sourceApp}; run bun run build:app first`)
if (!Bun.which('create-dmg'))
  fail('create-dmg not found; install it with `brew install create-dmg`')

const signing = readSigningEnv({ env: process.env })
if (signing && !existsSync(entitlementsPath)) fail(`missing ${entitlementsPath}`)
mkdirSync(artifacts, { recursive: true })
const dmgName = dmgNameFor({ channel: CHANNEL, platform: PLATFORM, productName: PRODUCT_NAME })
const version = process.env.ATLAS_VERSION?.trim()
const artifactName = version
  ? dmgArtifactNameFor({ channel: CHANNEL, platform: PLATFORM, productName: PRODUCT_NAME, version })
  : dmgName
const outputPath = join(artifacts, artifactName)

const work = mkdtempSync(join(tmpdir(), 'atlas-dmg-'))
try {
  const staging = join(work, 'staging')
  mkdirSync(staging)
  const stagedApp = join(staging, APP_BUNDLE_NAME)
  cpSync(sourceApp, stagedApp, { recursive: true, verbatimSymlinks: true })

  if (signing) signApp({ app: stagedApp, signing })
  else
    console.log('make-dmg: signing env absent or ATLAS_MAC_UNSIGNED=1; app and DMG left unsigned')

  const background = join(work, 'background.tiff')
  run({
    cmd: [
      'tiffutil',
      '-cathidpicheck',
      join(assets, 'background.png'),
      join(assets, 'background@2x.png'),
      '-out',
      background,
    ],
  })
  const volumeIcon = join(work, 'volume.icns')
  run({ cmd: ['iconutil', '-c', 'icns', join(appRoot, 'icon.iconset'), '-o', volumeIcon] })

  const branded = join(work, dmgName)
  run({
    cmd: [
      'create-dmg',
      ...buildCreateDmgArgs({
        appName: APP_BUNDLE_NAME,
        volumeName: PRODUCT_NAME,
        volumeIcon,
        background,
        outputPath: branded,
        sourceDir: staging,
      }),
    ],
  })
  rmSync(outputPath, { force: true })
  cpSync(branded, outputPath)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (signing) signAndNotarize({ dmg: outputPath, signing })
const written = [artifactName]
if (artifactName !== dmgName) {
  cpSync(outputPath, join(artifacts, dmgName))
  written.push(dmgName)
}
report({ names: written })
