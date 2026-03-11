import { useQuery } from '@tanstack/react-query';
import type { UserProfile } from '@steadfirm/shared';
import { userQueries } from '@/api/users';

/**
 * Returns the current user's profile. The data is pre-fetched by the
 * requireAuth route guard, so this hook will return cached data immediately
 * on first render (no loading flash).
 */
export function useCurrentUser(): UserProfile {
  const { data } = useQuery(userQueries.me());

  // The route guard guarantees this data exists for any authenticated page.
  // If somehow missing, fail hard (no silent fallbacks).
  if (!data) {
    throw new Error('useCurrentUser called before user profile was loaded');
  }

  return data;
}
