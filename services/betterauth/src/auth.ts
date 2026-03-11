import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.BETTER_AUTH_DATABASE!,
});

const webhookSecret = process.env.WEBHOOK_SECRET!;
const backendUrl = process.env.BACKEND_INTERNAL_URL || "http://localhost:3001";

/**
 * Compute HMAC-SHA256 hex signature for webhook payload authentication.
 */
async function signPayload(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3002",
  basePath: "/api/auth",
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh session every 24 hours
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL || "http://localhost:18002",
    "http://localhost:5173", // web frontend dev (vite)
    "http://localhost:18003", // web frontend dev (alt)
    "http://localhost:3001", // axum backend
    "http://localhost:18080", // caddy
    "http://192.168.0.99:5173", // LAN dev access
  ],
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // Trigger auto-provisioning when a new user signs up.
      // Fires on both email signup and social (OAuth) signup.
      if (!ctx.path.startsWith("/sign-up")) return;

      const newSession = ctx.context.newSession;
      if (!newSession) return;

      const { user } = newSession;
      const payload = JSON.stringify({
        userId: user.id,
        name: user.name,
        email: user.email,
      });

      // Fire-and-forget: don't block the signup response.
      // The backend will provision services asynchronously.
      signPayload(payload)
        .then((signature) =>
          fetch(`${backendUrl}/api/v1/hooks/user-created`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Webhook-Signature": signature,
            },
            body: payload,
          }),
        )
        .then((res) => {
          if (!res.ok) {
            console.error(
              `[webhook] user-created hook failed: ${res.status} ${res.statusText}`,
            );
          }
        })
        .catch((err) => {
          console.error("[webhook] user-created hook error:", err);
        });
    }),
  },
});
