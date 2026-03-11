import type { UserProfile } from '@steadfirm/shared';
import { api } from './client';

/**
 * Fetches the current user's profile and triggers auto-provisioning
 * on the backend if the user has no service connections yet.
 */
export async function fetchCurrentUser(): Promise<UserProfile> {
  return api.get('api/v1/users/me').json<UserProfile>();
}

export const userQueries = {
  me: () => ({
    queryKey: ['users', 'me'] as const,
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000, // 5 minutes — profile rarely changes
  }),
};
