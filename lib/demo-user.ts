// The app has no sign-in: every request is this one demo user.
// Profile, decision log and agent action log rows are all keyed by this id. The logs are append-only,
// so a fresh demo (empty portfolio, no history) is started by setting DEMO_USER_ID to a new value.
export const DEMO_USER = {
    id: process.env.DEMO_USER_ID || 'demo-user',
    name: 'Demo user',
    email: 'demo@example.com',
} as const;
