import ky from 'ky';
import { message } from 'antd';
import { log } from '@/lib/logger';

export const api = ky.create({
  prefixUrl: window.location.origin,
  credentials: 'include',
  retry: {
    limit: 2,
    methods: ['get'],
  },
  timeout: 30000,
  hooks: {
    afterResponse: [
      async (request, _options, response) => {
        const requestId = response.headers.get('x-request-id');
        const ctx: Record<string, unknown> = {
          method: request.method,
          url: request.url,
          status: response.status,
          ...(requestId && { requestId }),
        };

        if (response.ok) {
          log.debug('api response', ctx);
          return;
        }

        // Read error body for logging (clone so downstream can still read it).
        let errorBody: string | undefined;
        try {
          errorBody = await response.clone().text();
          // Try to parse as JSON for structured logging.
          try {
            ctx.error = JSON.parse(errorBody);
          } catch {
            ctx.error = errorBody.slice(0, 500);
          }
        } catch {
          ctx.error = '<unreadable>';
        }

        log.error('api error', ctx);

        if (response.status === 401) {
          window.location.href = '/login';
        }

        if (response.status === 403) {
          void message.error("You don't have access to this resource");
        }

        if (response.status >= 500) {
          void message.error('Something went wrong. Please try again.');
        }
      },
    ],
  },
});
