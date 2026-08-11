// Keep in sync with `basePath` in next.config.ts — needed because plain
// <img>/<video> src strings aren't rewritten by Next.js the way next/image is.
// Empty now that the site deploys under a custom domain (served from "/"
// rather than /<repo>/) — see next.config.ts and public/CNAME.
const BASE_PATH = "";

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
