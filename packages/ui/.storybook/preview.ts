import type { Preview } from "@storybook/react-vite";

import "../src/styles/fonts.css";
import "../src/styles/theme.css";
import "../src/styles/base.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
  },
};

export default preview;
