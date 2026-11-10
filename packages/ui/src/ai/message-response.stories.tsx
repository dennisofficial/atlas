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

const BROKEN_DIAGRAM = [
  '```mermaid',
  'flowchart LR',
  '  A[Start --> B{Check',
  '  B --> C',
  '```',
].join('\n')

export const BrokenDiagram: Story = {
  args: {
    children: BROKEN_DIAGRAM,
    onRepairDiagram: () => new Promise((resolve) => setTimeout(resolve, 1500)),
  },
}

const LARGE_DIAGRAM = [
  '```mermaid',
  'sequenceDiagram',
  '  participant C as Client',
  '  participant CP as Control plane',
  '  participant R as Redis',
  '  participant W1 as Worker 1',
  '  participant W2 as Worker 2',
  '  participant PG as Postgres',
  '  C->>CP: send message',
  '  CP->>PG: append event and enqueue turn',
  '  CP->>R: publish wake',
  '  R->>W1: wake',
  '  R->>W2: wake',
  '  W1->>PG: claim lease (wins)',
  '  W2->>PG: claim lease (loses)',
  '  W1->>PG: stream events',
  '  W1->>R: publish live output',
  '  R->>CP: live output',
  '  CP->>C: stream to client',
  '  W1->>PG: release lease',
  '```',
].join('\n')

export const LargeDiagram: Story = {
  args: { children: LARGE_DIAGRAM },
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
  'Inline math $$E = mc^2$$ and a block:',
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

const REPORTED_ITALICS = [
  'Best value so far is DeepSeek V4.1 Flash 1017 Fast — 1 high and 4 mediums for $21.94, ten times the surface coverage of the control for less money. Kimi reviewed the most ground (252 surface) but cost $54.80 to produce 26 informational items, so it buries the signal.',
  '',
  'The earlier *standard* run (555 requests, $23) *filed the CORS wildcard* — the deep control run *recorded it as ruled out*.',
].join('\n')

export const ReportedItalics: Story = {
  args: { children: REPORTED_ITALICS },
}

const INDENTED_CHECKLIST = [
  '- [ ] Parent task with a long enough line that it wraps around the container width',
  '  - [x] Nested done child',
  '  - [ ] Nested open child',
  '    - [ ] Grandchild task',
  '- [ ] Second parent',
  '  - Plain nested bullet',
  '  - [ ] Nested task with `code`',
  '',
  '1. [ ] Ordered task',
  '2. [x] Ordered done',
  '   - [ ] Nested under ordered',
  '   - [x] Nested done under ordered',
].join('\n')

export const IndentedChecklist: Story = {
  args: { children: INDENTED_CHECKLIST },
}

const INDENTED_LINES = [
  'A paragraph whose next line is indented by two spaces',
  '  and this is that indented line.',
  '',
  'A paragraph, a blank line, then a four-space indented code block:',
  '',
  '    const indented = true',
  '      still inside the block',
  '',
  '- A list item that wraps',
  '  with a two-space continuation line',
  '    and a four-space continuation line',
  '- A list item with an indented code block:',
  '',
  '      npm install @dltech/atlas',
  '      bun run dev',
  '',
  '- Nested plain lists',
  '  - Level two',
  '    - Level three',
  '      - Level four',
  '> A quote that wraps',
  '> onto an indented line inside the quote',
].join('\n')

export const IndentedLines: Story = {
  args: { children: INDENTED_LINES },
}
