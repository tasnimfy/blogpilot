/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone server output so `next start` works in the Docker image
  // (docker/entrypoint.sh starts the app with `next start`).
  output: "standalone",
};

export default nextConfig;
