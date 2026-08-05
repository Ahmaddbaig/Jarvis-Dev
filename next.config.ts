import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Electron launches the generated standalone server from resources/app.
  output: "standalone",
  reactStrictMode: false,
  // Avoid Next's runtime image cache writing inside the signed macOS bundle.
  images: { unoptimized: true },
  serverExternalPackages: ["@jitsi/robotjs", "screenshot-desktop", "sharp"],
  experimental: {
    mcpServer: true,
  },
};

export default nextConfig;
