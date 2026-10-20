import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar, AvatarFallback } from "@dltech/atlas-ui/components/avatar";
import { Bubble, BubbleContent } from "@dltech/atlas-ui/components/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@dltech/atlas-ui/components/message";

const meta = {
  title: "Components/Message",
  component: Message,
  argTypes: { align: { control: "inline-radio", options: ["start", "end"] } },
  args: { align: "start" },
  decorators: [
    (Story) => (
      <div className="w-[32rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Message>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Message {...args}>
      <MessageAvatar>
        <Avatar size="sm">
          <AvatarFallback>AT</AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Atlas</MessageHeader>
        <Bubble variant="muted">
          <BubbleContent>Renamed the store and updated 11 imports. Running the typecheck now.</BubbleContent>
        </Bubble>
        <MessageFooter>10:42</MessageFooter>
      </MessageContent>
    </Message>
  ),
};

export const Conversation: Story = {
  render: () => (
    <MessageGroup>
      <Message align="end">
        <MessageContent>
          <Bubble variant="default" align="end">
            <BubbleContent>Rename the session store and fix the imports.</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageAvatar>
          <Avatar size="sm">
            <AvatarFallback>AT</AvatarFallback>
          </Avatar>
        </MessageAvatar>
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent>Done. 3 files renamed, typecheck passes.</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageGroup>
  ),
};
