import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@treasury-copilot/shared"],
  outputFileTracingIncludes: {
    "/*": ["../../contracts/genlayer/**/*.py"],
  },
};

export default nextConfig;
