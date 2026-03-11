import { auth } from "./auth";

const server = Bun.serve({
  port: 3002,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "betterauth" });
    }

    // BetterAuth handles all /api/auth/* routes
    return auth.handler(request);
  },
});

console.log(`BetterAuth sidecar listening on ${server.url}`);
