import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev-tools badge (the "N" circle in the
  // corner) — it reads as a stray UI element on the map. Dev-only anyway.
  devIndicators: false,
};

export default nextConfig;
