/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['snowflake-sdk'],
  },
};
module.exports = nextConfig;
