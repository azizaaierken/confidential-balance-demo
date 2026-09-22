// The console is a client-rendered app: every piece of state comes from a
// fetch to this app's own API routes after mount (the same round trip the
// old Next.js client made to the Rust service), so nothing meaningful can be
// server-rendered. The server-side layout load still runs and passes the
// SSO identity down.
export const ssr = false;
export const prerender = false;
