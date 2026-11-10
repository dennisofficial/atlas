import type { ElectrobunConfig } from 'electrobun'

const version = process.env.ATLAS_VERSION || '0.1.0'
const signed = process.env.ATLAS_MAC_UNSIGNED !== '1'

export default {
  app: {
    name: 'Atlas',
    identifier: 'io.byatlas.mac',
    version,
    urlSchemes: ['atlas'],
  },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'main-out/index.js', external: ['undici'] },
    copy: { 'web-standalone': 'web' },
    mac: {
      codesign: signed,
      // Hutch submits the app and the DMG as two separate notarizations when both are enabled.
      // scripts/make-dmg.ts submits the DMG once, and Apple's acceptance covers the app in it.
      notarize: false,
      createDmg: false,
      icons: 'icon.iconset',
      // CEF is off until Hutch stages its helper apps with an Info.plist carrying LSUIElement; without one
      // each helper claims a Dock tile at every launch. The pane runs on WKWebView either way (see README).
      bundleCEF: false,
      entitlements: {
        'com.apple.security.cs.allow-jit': true,
        'com.apple.security.cs.allow-unsigned-executable-memory': true,
      },
    },
  },
  release: {
    baseUrl: 'https://github.com/dennisofficial/atlas/releases/latest/download',
    generatePatch: true,
  },
  scripts: { postWrap: './scripts/wrapper-autoclose.ts' },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig
