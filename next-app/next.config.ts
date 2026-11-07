import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  // This repository is published at https://771523543.github.io/BTC-RADAR/
  basePath: "/BTC-RADAR",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
