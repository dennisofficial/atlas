// Vercel caps request bodies at 4.5 MB (https://vercel.com/docs/functions/limitations); base64 inflates 3,000,000 bytes to 4,000,000.
export const MAX_USER_LAYER_FILE_BYTES = 3_000_000

const BYTES_PER_MEGABYTE = 1_000_000

export const megabytes = (bytes: number): string => (bytes / BYTES_PER_MEGABYTE).toFixed(1)
