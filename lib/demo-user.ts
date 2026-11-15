// The app has no sign-in: every request is this one demo user.
// Profile, decision log and agent action log rows are all keyed by this id.
export const DEMO_USER = {
    id: 'demo-user',
    name: 'Demo user',
    email: 'demo@example.com',
} as const;
