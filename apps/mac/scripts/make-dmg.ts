import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildCreateDmgArgs, pickDmgName, readSigningEnv, type SigningEnv } from './dmg-plan'

const appRoot = resolve(import.meta.dir, '..')
const assets = join(appRoot, 'assets', 'dmg')

function fail(message: string): never {
  console.error(`make-dmg: ${message}`)
  process.exit(1)
}

function run({ cmd }: { cmd: string[] }) {
  console.log(`$ ${cmd.join(' ')}`)
  const result = Bun.spawnSync({ cmd, stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode !== 0) fail(`${cmd[0]} exited with ${result.exitCode}`)
}

function findApp(): string {
  const buildDir = join(appRoot, 'build')
  const channelDir = existsSync(buildDir)
    ? readdirSync(buildDir).find((entry) => /^stable-macos-/.test(entry))
    : undefined
  if (!channelDir) fail(`no stable-macos-* directory in ${buildDir}; run electrobun build first`)
  const app = readdirSync(join(buildDir, channelDir)).find((entry) => entry.endsWith('.app'))
  if (!app) fail(`no .app in ${join(buildDir, channelDir)}`)
  return join(buildDir, channelDir, app)
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

function stapleApp({ app }: { app: string }) {
  const validate = Bun.spawnSync({
    cmd: ['xcrun', 'stapler', 'validate', app],
    stdout: 'ignore',
    stderr: 'ignore',
  })
  if (validate.exitCode === 0) return
  run({ cmd: ['xcrun', 'stapler', 'staple', app] })
}

if (process.platform !== 'darwin') {
  fail(
    'requires macOS (hdiutil, create-dmg, codesign, notarytool); run it on a Mac or in the mac CI jobs',
  )
}
if (!Bun.which('create-dmg'))
  fail('create-dmg not found; install it with `brew install create-dmg`')

const signing = readSigningEnv({ env: process.env })
const sourceApp = findApp()
const appName = sourceApp.split('/').pop() as string
const artifacts = join(appRoot, 'artifacts')
const existing = existsSync(artifacts) ? pickDmgName({ files: readdirSync(artifacts) }) : null
if (!existing) fail(`no macos .dmg in ${artifacts}; run electrobun build first`)
const outputPath = join(artifacts, existing)

const work = mkdtempSync(join(tmpdir(), 'atlas-dmg-'))
try {
  const staging = join(work, 'staging')
  mkdirSync(staging)
  cpSync(sourceApp, join(staging, appName), { recursive: true, verbatimSymlinks: true })
  if (signing) stapleApp({ app: join(staging, appName) })

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

  const branded = join(work, existing)
  run({
    cmd: [
      'create-dmg',
      ...buildCreateDmgArgs({
        appName,
        volumeName: 'Atlas',
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
else console.log('make-dmg: signing env absent or ATLAS_MAC_UNSIGNED=1; DMG left unsigned')
console.log(`make-dmg: wrote ${outputPath}`)
