import { buildThemeCss } from "../src/tokens/css";

const outputPath = new URL("../src/styles/theme.css", import.meta.url);
await Bun.write(outputPath, buildThemeCss());
console.log(`wrote ${outputPath.pathname}`);
