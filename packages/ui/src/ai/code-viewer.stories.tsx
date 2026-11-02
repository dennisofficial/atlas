import type { Meta, StoryObj } from '@storybook/react'

import { CodeViewer, type CodeLineMark } from './code-viewer'

const SOURCE = `import { useState } from 'react'

export function Counter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start)
  const handleClick = () => setCount((value) => value + 1)
  return (
    <button type="button" onClick={handleClick}>
      Clicked {count} times — a long line that scrolls sideways instead of wrapping, so the gutter stays put
    </button>
  )
}
`

const MARKS = new Map<number, CodeLineMark>([
  [2, 'added'],
  [3, 'added'],
  [5, 'modified'],
  [7, 'deleted-above'],
])

const meta = {
  title: 'AI/Code Viewer',
  component: CodeViewer,
  args: { path: 'src/counter.tsx', content: SOURCE, language: 'tsx', marks: MARKS },
  decorators: [
    (Story) => (
      <div className="h-80 w-[40rem] max-w-full rounded-lg border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeViewer>

export default meta

type Story = StoryObj<typeof meta>

export const ChangeGutter: Story = {}

export const Unchanged: Story = { args: { marks: undefined } }

export const PlainText: Story = { args: { language: null, path: 'notes.txt' } }

export const DeletedAtEnd: Story = {
  args: { marks: new Map<number, CodeLineMark>([[12, 'deleted-above']]) },
}
