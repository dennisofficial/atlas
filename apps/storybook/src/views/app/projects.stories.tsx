import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppShell, EAppNav } from "./app-shell";
import { ENewProjectStep, EProjectSource } from "./projects/new-project-types";
import { ProjectsView, type ProjectsViewProps } from "./projects/projects-view";

function ProjectsPage(props: ProjectsViewProps) {
  return (
    <AppShell activeNav={EAppNav.Projects}>
      <ProjectsView {...props} />
    </AppShell>
  );
}

const meta = {
  title: "Views/App/Projects",
  component: ProjectsPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProjectsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Personal: Story = { args: { initialOwnerId: "dennisofficial" } };

export const Workspace: Story = { args: { initialOwnerId: "compai" } };

export const All: Story = { args: { initialOwnerId: null } };

export const NewProjectSource: Story = {
  args: { initialOwnerId: "compai", newProject: { step: ENewProjectStep.Source } },
};

export const NewProjectRepository: Story = {
  args: {
    initialOwnerId: "compai",
    newProject: { step: ENewProjectStep.Repository, draft: { repo: "compai/csa", repoQuery: "compai/csa" } },
  },
};

export const NewProjectRepositoryPicker: Story = {
  args: {
    initialOwnerId: "compai",
    newProject: { step: ENewProjectStep.Repository, pickerOpen: true, draft: { repoQuery: "comp" } },
  },
};

export const NewProjectPastedUrl: Story = {
  args: {
    initialOwnerId: "compai",
    newProject: {
      step: ENewProjectStep.Repository,
      pickerOpen: true,
      draft: { repoQuery: "https://github.com/vercel/ai.git" },
    },
  },
};

export const NewProjectNewRepository: Story = {
  args: {
    initialOwnerId: "compai",
    newProject: {
      step: ENewProjectStep.Repository,
      draft: { source: EProjectSource.NewRepo, newRepoName: "support-bot" },
    },
  },
};

export const NewProjectDetails: Story = {
  args: {
    initialOwnerId: "compai",
    newProject: { step: ENewProjectStep.Details, draft: { repo: "dennisofficial/billing-portal" } },
  },
};

export const NewProjectGithubNotConnected: Story = {
  args: { newProject: { step: ENewProjectStep.Repository, githubConnected: false } },
};

export const NewProjectDuplicateName: Story = {
  args: {
    initialOwnerId: "compai",
    newProject: {
      step: ENewProjectStep.Details,
      draft: { repo: "compai/comp-v3", name: "comp-v3", nameTouched: true, ownerId: "compai" },
    },
  },
};

export const NewProjectBadUrl: Story = {
  args: {
    newProject: {
      step: ENewProjectStep.Repository,
      pickerOpen: true,
      draft: { repoQuery: "gitlab.com/acme/widgets" },
    },
  },
};
