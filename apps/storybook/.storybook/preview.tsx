import type { Decorator, Preview } from "@storybook/react-vite";
import { ThemeProvider } from "next-themes";

import "@dltech/atlas-ui/fonts.css";
import "../src/styles.css";

const handleThemeDecorator: Decorator = (Story, context) => {
  const theme = context.globals["theme"] === "light" ? "light" : "dark";
  document.documentElement.classList.toggle("light", theme === "light");
  return (
    <ThemeProvider
      attribute="class"
      forcedTheme={theme}
      disableTransitionOnChange
    >
      <Story />
    </ThemeProvider>
  );
};

const preview: Preview = {
  parameters: {
    layout: "centered",
  },
  globalTypes: {
    theme: {
      description: "Color scheme",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "dark",
  },
  decorators: [handleThemeDecorator],
};

export default preview;
