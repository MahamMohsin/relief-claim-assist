import type { NextConfig } from "next";

const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"],
};

export default config;
