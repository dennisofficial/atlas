import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'Atlas',
    identifier: 'io.byatlas.mac',
    version: '0.1.0',
  },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'main-out/index.js', external: ['undici'] },
    copy: { 'web-out': 'web' },
    mac: { codesign: true, notarize: true, createDmg: true },
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig
