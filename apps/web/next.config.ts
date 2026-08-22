import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@kilnflow/shared-types'],
};

export default nextConfig;