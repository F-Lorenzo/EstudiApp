import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.4 no puede interpretar `tsc --showConfig` de TypeScript 6 durante
    // `next build`. El chequeo estricto permanece cubierto por `npm run typecheck`.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
