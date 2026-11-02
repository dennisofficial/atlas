import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import type { StorybookConfig } from '@storybook/nextjs-vite'

const webSource = fileURLToPath(new URL('../../web/src', import.meta.url))

const config: StorybookConfig = {
  stories: [
    '../../../packages/ui/src/**/*.stories.@(ts|tsx)',
    '../../web/src/features/**/*.stories.@(ts|tsx)',
  ],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  viteFinal: async (config) => {
    const aliases = config.resolve?.alias ?? []
    config.resolve = {
      ...config.resolve,
      dedupe: [...(config.resolve?.dedupe ?? []), 'react', 'react-dom'],
      alias: [
        ...(Array.isArray(aliases)
          ? aliases
          : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }))),
        { find: '@', replacement: webSource },
      ],
    }
    config.plugins = [
      ...(config.plugins ?? []),
      {
        name: 'production-sidebar-styles',
        enforce: 'pre',
        transform(source, id) {
          if (!id.endsWith('/apps/storybook/src/styles.css')) return
          return `${source}\n@source "${webSource}";`
        },
      },
      tailwindcss(),
    ]
    return config
  },
}

export default config
