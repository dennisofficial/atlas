import type { ElectrobunConfig } from 'electrobun'

const version = process.env.ATLAS_VERSION || '0.1.0'
const signed = process.env.ATLAS_MAC_UNSIGNED !== '1'

export default {
  app: {
    name: 'Atlas',
    identifier: 'io.byatlas.mac',
    version,
  },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'main-out/index.js', external: ['undici'] },
    copy: { 'web-out': 'web' },
    mac: { codesign: signed, notarize: signed, createDmg: true, icons: 'icon.iconset' },
  },
  release: {
    baseUrl: 'https://github.com/dennisofficial/atlas/releases/latest/download',
    generatePatch: true,
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig
