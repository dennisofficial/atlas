import type { Meta, StoryObj } from "@storybook/react-vite";

import { NewThreadView } from "./new-thread/new-thread-view";
import { ENewThreadOutcome, ENewThreadStage } from "./new-thread/new-thread-types";

const meta = {
  title: "Views/App/NewThread",
  component: NewThreadView,
  parameters: { layout: "fullscreen" },
  argTypes: {
    outcome: { control: "select", options: Object.values(ENewThreadOutcome) },
  },
} satisfies Meta<typeof NewThreadView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};

export const EmptyThread: Story = { args: { initialStage: ENewThreadStage.Empty } };

export const WaitingForPod: Story = { args: { initialStage: ENewThreadStage.WaitingForPod } };

export const NoProject: Story = {
  args: { initialStage: ENewThreadStage.WaitingForPod, initialProjectId: null },
};

export const SettingUpWorkspace: Story = { args: { initialStage: ENewThreadStage.SettingUpWorkspace } };

export const Streaming: Story = { args: { initialStage: ENewThreadStage.Streaming } };

export const FirstTurnDone: Story = { args: { initialStage: ENewThreadStage.Idle } };

export const NoVercelToken: Story = { args: { initialStage: ENewThreadStage.NoVercelToken } };

export const ProvisionFailed: Story = { args: { initialStage: ENewThreadStage.ProvisionFailed } };

export const Interactive: Story = { args: { autoRun: true, outcome: ENewThreadOutcome.Success } };
