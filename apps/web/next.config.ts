import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@treasury-copilot/shared"],
  outputFileTracingIncludes: {
    // The policy source is read at runtime through a dynamic path the tracer cannot follow, so it
    // must be declared. "/**" rather than "/*" because the route that needs it is nested
    // (/api/v1/setup), which a single-segment pattern does not match.
    "/**": ["../../contracts/genlayer/**/*.py"],
  },
};

export default nextConfig;
