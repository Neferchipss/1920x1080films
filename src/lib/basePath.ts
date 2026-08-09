// Keep in sync with `basePath` in next.config.ts — needed because plain
// <img>/<video> src strings aren't rewritten by Next.js the way next/image is.
const BASE_PATH = "/1920x1080films";

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
