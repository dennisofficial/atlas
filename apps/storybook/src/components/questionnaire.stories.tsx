import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@dltech/atlas-ui/components/questionnaire";

const meta = {
  title: "Components/Questionnaire",
  component: Questionnaire,
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Questionnaire>;

export default meta;

type Story = StoryObj<typeof meta>;

const items = [
  { name: "approach", required: true, choices: [{ value: "rewrite" }, { value: "patch" }] },
  { name: "scope", choices: [{ value: "web" }, { value: "tui" }, { value: "api" }] },
  { name: "notes" },
];

export const Default: Story = {
  render: (args) => (
    <Questionnaire items={items} shortcuts="numbers" onSubmit={(event) => event.preventDefault()} {...args}>
      <QuestionnaireProgress />
      <QuestionnaireItem name="approach" required>
        <QuestionnaireTitle>How should Atlas fix the reconnect bug?</QuestionnaireTitle>
        <QuestionnaireDescription>The two options differ in how much of the client changes.</QuestionnaireDescription>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="rewrite">
            Rewrite the retry loop
            <QuestionnaireChoiceDescription>Cleaner, touches four files.</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
          <QuestionnaireChoice value="patch">
            Patch the timer race
            <QuestionnaireChoiceDescription>One-line change, keeps the structure.</QuestionnaireChoiceDescription>
          </QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireItem name="scope" multiple>
        <QuestionnaireTitle>Which surfaces does this touch?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="web">Web</QuestionnaireChoice>
          <QuestionnaireChoice value="tui">Terminal</QuestionnaireChoice>
          <QuestionnaireChoice value="api">API</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireItem name="notes">
        <QuestionnaireTitle>Anything else Atlas should know?</QuestionnaireTitle>
        <QuestionnaireInput placeholder="Optional notes" />
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit />
      </QuestionnaireActions>
    </Questionnaire>
  ),
};
