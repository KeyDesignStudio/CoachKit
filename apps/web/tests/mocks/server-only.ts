// Vitest runs in Node (server-like) and doesn't apply Next.js bundler transforms.
// Next.js replaces `server-only` with an empty module on the server.
// In tests, we alias `server-only` to this file so server modules can be imported.
export {};
