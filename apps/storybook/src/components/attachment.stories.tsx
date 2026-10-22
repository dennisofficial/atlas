import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileCodeIcon, FileTextIcon, XIcon } from 'lucide-react'

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@dltech/atlas-ui/components/attachment'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

const meta = {
  title: 'Components/Attachment',
  component: Attachment,
  argTypes: { size: { control: 'inline-radio', options: ['default', 'sm', 'xs'] } },
  args: { size: 'default' },
} satisfies Meta<typeof Attachment>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Attachment className="w-72" {...args}>
      <AttachmentMedia>
        <FileCodeIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>session-store.ts</AttachmentTitle>
        <AttachmentDescription>4.2 KB</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label="Remove attachment">
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  ),
}

export const Uploading: Story = {
  render: (args) => (
    <Attachment className="w-72" {...args}>
      <AttachmentMedia>
        <Spinner />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>architecture.pdf</AttachmentTitle>
        <AttachmentDescription>Uploading…</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ),
}

export const Group: Story = {
  render: (args) => (
    <AttachmentGroup className="w-72">
      {['notes.md', 'trace.log', 'schema.sql'].map((name) => (
        <Attachment key={name} {...args}>
          <AttachmentMedia>
            <FileTextIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{name}</AttachmentTitle>
          </AttachmentContent>
          <AttachmentTrigger aria-label={`Open ${name}`} />
        </Attachment>
      ))}
    </AttachmentGroup>
  ),
}
