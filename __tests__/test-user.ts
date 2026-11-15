// The single session the service and route tests run as: DEMO_USER_ID (the local override of lib/session) makes
// every request without a cookie, and every call outside a request, use it. Import this before calling a service.
import { ZERO_GENERATIONS, scopeFor } from '@/lib/session/scope';

process.env.DEMO_USER_ID ||= 'demo-user';

export const TEST_SCOPE = scopeFor(process.env.DEMO_USER_ID, ZERO_GENERATIONS);
