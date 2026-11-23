export const clipText = ({ text, limit }: { text: string; limit: number }): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
