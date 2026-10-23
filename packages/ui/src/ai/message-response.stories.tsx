import type { Meta, StoryObj } from '@storybook/react'

import { MessageResponse } from './message-response'

const INTRO = [
  '## What changed',
  '',
  'The web transcript now renders agent replies as **Markdown**, with `inline code` that stays inline and [links](https://example.com) that open in a new tab.',
  '',
  '- **Headings and lists** use the same type scale as the rest of the thread',
  '- **Tables** are built from our own `Table` parts',
  '- **Code fences** go through the shared `CodeBlock` and Shiki highlighter',
].join('\n')

const TABLE = [
  '### Packages and their boundaries',
  '',
  '| Package | Depends on | Owns |',
  '| --- | --- | --- |',
  '| `@dltech/atlas-core` | `zod` only | Events, IDs, context assembly, hook and port contracts. Pure. |',
  '| `@dltech/atlas-harness` | core | The loop, hooks, tools, model adapters, credentials, store. |',
  '| `@dltech/atlas-ui` | nothing | Design tokens and shadcn components plus AI patterns. |',
  '| `web` | nothing in-repo | Atlas Cloud frontend. |',
].join('\n')

const CODE = [
  '```ts',
  'export function titleOf(label: string, running: boolean): string {',
  '  return running ? `Running ${label}` : `Ran ${label}`',
  '}',
  '```',
].join('\n')

const DIAGRAM = [
  '```mermaid',
  'flowchart LR',
  '  Web --> Api',
  '  Api --> Serve',
  '  Serve --> Harness',
  '```',
].join('\n')

const OUTRO = ['---', '', 'Last paragraph after a rule.'].join('\n')

const FIXTURE = [INTRO, TABLE, CODE, DIAGRAM, OUTRO].join('\n\n')

const meta = {
  title: 'AI/MessageResponse',
  component: MessageResponse,
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full text-sm leading-relaxed">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageResponse>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: FIXTURE },
}

export const Streaming: Story = {
  args: {
    isAnimating: true,
    caret: 'block',
    children: [INTRO, TABLE, CODE.slice(0, CODE.indexOf('running ?') + 12)].join('\n\n'),
  },
}

export const Table: Story = {
  args: { children: TABLE },
}

export const Diagram: Story = {
  args: { children: DIAGRAM },
}

const EXTENDED = [
  'Task list:',
  '',
  '- [x] Render headings',
  '- [ ] Render footnotes',
  '',
  'Nested:',
  '',
  '- First item',
  '  - Nested item with `code`',
  '',
  '3. Starts at three',
  '4. Continues',
  '',
  '> [!NOTE]',
  '> GitHub-style admonition with `code`.',
  '',
  '> [!WARNING]',
  '> A warning admonition.',
  '',
  'Inline math $E = mc^2$ and a block:',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  'Shortcode :rocket: and a footnote.[^1]',
  '',
  '***',
  '',
  'Text after a star rule.',
  '',
  '[^1]: The footnote, with a back link that stays on the page.',
].join('\n')

export const Extended: Story = {
  args: { children: EXTENDED },
}

export const StreamingText: Story = {
  args: {
    isAnimating: true,
    caret: 'block',
    children: 'Reading the **token generator** and checking which',
  },
}
