import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@kilnflow/shared-types'],
};

export default nextConfig;