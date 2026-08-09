import type { NextConfig } from "next";

const repoName = "1920x1080films";

const nextConfig: NextConfig = {
  output: "export",
  basePath: `/${repoName}`,
  images: { unoptimized: true },
};

export default nextConfig;
