import tailwindcss from '@tailwindcss/vite'
import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  stories: ['../../../packages/ui/src/**/*.stories.@(ts|tsx)'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  viteFinal: async (config) => {
    config.plugins = [...(config.plugins ?? []), tailwindcss()]
    return config
  },
}

export default config
