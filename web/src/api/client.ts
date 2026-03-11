import ky from 'ky';

export const api = ky.create({
  prefixUrl: '',
  credentials: 'include',
  retry: {
    limit: 2,
    methods: ['get'],
  },
  timeout: 30000,
  hooks: {
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          window.location.href = '/login';
        }
      },
    ],
  },
});
