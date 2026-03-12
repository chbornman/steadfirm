import { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import type { PaginatedResponse } from '@steadfirm/shared';
import { DEFAULT_PAGE_SIZE } from '@steadfirm/shared';
import { api } from '@/api/client';
import { useIntersection } from './useIntersection';

interface UseContentListOptions<T> {
  /** React Query cache key */
  queryKey: QueryKey;
  /** API endpoint path (relative to api prefix, e.g. 'api/v1/photos') */
  endpoint: string;
  /** Additional search params beyond page/pageSize */
  params?: Record<string, string | number | boolean>;
  /** Override default page size */
  pageSize?: number;
  /** Whether the query is enabled (default true) */
  enabled?: boolean;
}

interface UseContentListResult<T> {
  /** Flattened items across all loaded pages */
  items: T[];
  /** Total count from first page response */
  totalCount: number;
  /** Ref to attach to the infinite scroll sentinel div */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the initial load is in progress */
  isLoading: boolean;
  /** Whether a subsequent page is being fetched */
  isFetchingNextPage: boolean;
  /** Whether there are more pages to load */
  hasNextPage: boolean;
  /** Access to the raw query data if needed */
  data: ReturnType<typeof useInfiniteQuery<PaginatedResponse<T>>>['data'];
}

/**
 * Shared infinite-scroll data fetching hook.
 *
 * Wraps useInfiniteQuery + useIntersection into a single call that handles:
 * - Paginated fetching with automatic next-page detection
 * - Intersection Observer sentinel for scroll-triggered loading
 * - Flattening pages into a single items array
 */
export function useContentList<T>({
  queryKey,
  endpoint,
  params = {},
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
}: UseContentListOptions<T>): UseContentListResult<T> {
  const { ref: sentinelRef, isIntersecting } = useIntersection({
    rootMargin: '200% 0px',
  });

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      api
        .get(endpoint, {
          searchParams: {
            page: pageParam,
            pageSize,
            ...params,
          },
        })
        .json<PaginatedResponse<T>>(),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    initialPageParam: 1,
    enabled,
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const totalCount = query.data?.pages[0]?.total ?? 0;

  return {
    items,
    totalCount,
    sentinelRef,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    data: query.data,
  };
}
