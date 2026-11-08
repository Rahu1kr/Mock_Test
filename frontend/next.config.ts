import type { NextConfig } from "next";

// Pages render client-side against the Express API, so Next's cacheComponents /
// partial-prefetch prerendering has nothing to cache here and only conflicts
// with the dynamic `useParams` routes.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
