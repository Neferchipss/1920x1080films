import type { NextConfig } from "next";

// No basePath: the site now deploys under a custom domain (see public/CNAME),
// which GitHub Pages serves from the domain root rather than /<repo>/. Asset
// paths from withBasePath() resolve directly off "/" as a result — see
// src/lib/basePath.ts.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
