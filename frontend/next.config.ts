import type { NextConfig } from "next";

// Pages render client-side against the Express API, so Next's cacheComponents /
// partial-prefetch prerendering has nothing to cache here and only conflicts
// with the dynamic `useParams` routes.
//
// BACKEND_ORIGIN (server-side only, e.g. http://ec2-….amazonaws.com) makes Next
// proxy /api/* to the backend. Set it together with NEXT_PUBLIC_API_BASE_URL=/
// so the browser calls /api on the frontend's own HTTPS origin: an HTTPS page
// (Vercel) may not call an HTTP API directly — browsers block it as mixed content.
const backend = process.env.BACKEND_ORIGIN?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  ...(backend && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
    },
  }),
};

export default nextConfig;
