import type { Meta, StoryObj } from "@storybook/react-vite";

import { Bubble, BubbleContent } from "@dltech/atlas-ui/components/bubble";
import { Message, MessageContent } from "@dltech/atlas-ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@dltech/atlas-ui/components/message-scroller";

const meta = {
  title: "Components/Message Scroller",
  component: MessageScroller,
} satisfies Meta<typeof MessageScroller>;

export default meta;

type Story = StoryObj<typeof meta>;

const turns = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  mine: index % 2 === 0,
  text: index % 2 === 0 ? `Request ${index / 2 + 1}: update the tests` : `Reply ${(index + 1) / 2}: edited 2 files, tests pass`,
}));

export const Default: Story = {
  render: () => (
    <MessageScrollerProvider>
      <MessageScroller className="h-80 w-96 rounded-lg border border-border">
        <MessageScrollerViewport>
          <MessageScrollerContent className="p-4">
            {turns.map((turn, index) => (
              <MessageScrollerItem key={turn.id} scrollAnchor={index === turns.length - 1}>
                <Message align={turn.mine ? "end" : "start"}>
                  <MessageContent>
                    <Bubble variant={turn.mine ? "default" : "muted"} align={turn.mine ? "end" : "start"}>
                      <BubbleContent>{turn.text}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  ),
};
