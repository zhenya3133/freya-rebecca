/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // typescript errors should be caught by CI typecheck
  // typescript: { ignoreBuildErrors: true }
};
export default nextConfig;
