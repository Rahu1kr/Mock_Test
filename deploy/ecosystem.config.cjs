// pm2 process list for the EC2 box. Both apps bind to localhost only;
// nginx (deploy/nginx.conf) is the public face on port 80.
const path = require("path");
const root = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "geo-backend",
      cwd: path.join(root, "backend"),
      script: "dist/server.js",
      env: { NODE_ENV: "production", PORT: "4000" },
      max_memory_restart: "300M",
    },
    {
      name: "geo-frontend",
      cwd: path.join(root, "frontend"),
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
    },
  ],
};
