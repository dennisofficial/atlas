import type { Meta, StoryObj } from '@storybook/react'

import { FileTree, type FileNode } from './file-tree'
import { FileIconsProvider, FileTypeIcon } from './file-type-icon'

const SAMPLES = [
  'index.ts',
  'App.tsx',
  'main.js',
  'styles.css',
  'package.json',
  'README.md',
  '.env.local',
  'Dockerfile',
  'photo.png',
  'unknown.xyz',
]

const FOLDERS = ['src', 'components', 'tests', '.github', 'assets', 'unknown']

const NODES: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    children: [
      {
        name: 'components',
        path: 'src/components',
        children: [{ name: 'App.tsx', path: 'src/components/App.tsx' }],
      },
      { name: 'index.ts', path: 'src/index.ts' },
      { name: 'styles.css', path: 'src/styles.css' },
    ],
  },
  { name: 'tests', path: 'tests', children: [] },
  { name: '.github', path: '.github', children: [] },
  { name: 'package.json', path: 'package.json' },
  { name: 'README.md', path: 'README.md' },
  { name: '.env.local', path: '.env.local' },
]

function SampleGrid({ colored }: { colored: boolean }) {
  return (
    <FileIconsProvider colored={colored}>
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{colored ? 'Colour' : 'Monochrome'}</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-xs">
          {SAMPLES.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <FileTypeIcon name={name} className="size-4" />
              <span>{name}</span>
            </div>
          ))}
          {FOLDERS.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <FileTypeIcon name={name} folder className="size-4" />
              <FileTypeIcon name={name} folder open className="size-4" />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </section>
    </FileIconsProvider>
  )
}

const meta = {
  title: 'AI/File Type Icon',
  component: FileTypeIcon,
  args: { name: 'index.ts' },
} satisfies Meta<typeof FileTypeIcon>

export default meta

type Story = StoryObj<typeof meta>

export const Modes: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-12">
      <SampleGrid colored={false} />
      <SampleGrid colored />
    </div>
  ),
}

function Explorer({ colored }: { colored: boolean }) {
  return (
    <FileIconsProvider colored={colored}>
      <div className="w-80">
        <FileTree nodes={NODES} open={['src', 'src/components']} />
      </div>
    </FileIconsProvider>
  )
}

export const MonochromeTree: Story = { render: () => <Explorer colored={false} /> }
export const ColorTree: Story = { render: () => <Explorer colored /> }
