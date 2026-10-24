import type { Meta, StoryObj } from '@storybook/react'
import { ArrowUpIcon, CopyIcon, SearchIcon } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '#components/input-group'
import { Spinner } from '#components/spinner'

const meta = {
  title: 'Components/Input Group',
  component: InputGroup,
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InputGroup>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search sessions" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>12 results</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const WithButton: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput readOnly defaultValue="https://atlas.dev/s/9f2c" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Copy link" size="icon-xs">
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const Loading: Story = {
  render: () => (
    <InputGroup data-disabled>
      <InputGroupInput disabled defaultValue="bun run typecheck" />
      <InputGroupAddon align="inline-end">
        <Spinner />
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const Textarea: Story = {
  render: () => (
    <InputGroup>
      <InputGroupTextarea placeholder="Ask Atlas to change something…" />
      <InputGroupAddon align="block-end">
        <InputGroupText>0 / 4000</InputGroupText>
        <InputGroupButton variant="default" size="sm" className="ml-auto">
          Send
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const ButtonSizes: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Message" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="xs">xs</InputGroupButton>
        <InputGroupButton size="sm">sm</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const RoundButton: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Ask Atlas" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Send" variant="default" size="icon-xs" shape="round">
          <ArrowUpIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
}
