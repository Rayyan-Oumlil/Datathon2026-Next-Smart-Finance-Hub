// The app has no sign-in: each browser is an anonymous session (lib/session). This is only what the shell shows as
// "the user": an example user's first name, or the generic demo user for any other session.
import { PERSONAS } from '@/lib/personas/presets';

export function displayUser(sessionId: string): { id: string; name: string; email: string } {
    const match = /^persona-([a-z]+)$/.exec(sessionId);
    const persona = match ? PERSONAS[match[1] as keyof typeof PERSONAS] : undefined;
    return { id: sessionId, name: persona?.displayName ?? 'Demo user', email: 'demo@example.com' };
}
