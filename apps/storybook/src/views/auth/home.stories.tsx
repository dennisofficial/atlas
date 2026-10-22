import type { Meta, StoryObj } from "@storybook/react-vite";

import { AuthPreview } from "./auth-preview";
import { EAuthScreen, EHomeState } from "./auth-route";
import { FULLSCREEN, demoArgType } from "./story-kit";

interface Args {
  demo: EHomeState;
}

const meta = {
  title: "Views/Auth/Home",
  parameters: FULLSCREEN,
  args: { demo: EHomeState.SignedOut },
  argTypes: {
    demo: demoArgType(Object.values(EHomeState)),
  },
  render: ({ demo }) => (
    <AuthPreview route={{ screen: EAuthScreen.Home, state: demo }} />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};
export const SignedIn: Story = { args: { demo: EHomeState.SignedIn } };
