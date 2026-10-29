import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'Atlas',
    identifier: 'io.byatlas.mac',
    version: '0.1.0',
  },
  build: {
    mainProcess: 'bun',
    bun: { entrypoint: 'src/main/index.ts' },
    copy: { 'web-out': 'web' },
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig
