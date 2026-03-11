import {
  createRouter,
  createRootRoute,
  createRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router';
import { AppLayout } from '@/layouts/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoginPage } from '@/pages/Login';
import { SignupPage } from '@/pages/Signup';
import { PhotosPage } from '@/pages/Photos';
import { MediaMoviesPage } from '@/pages/MediaMovies';
import { MediaShowsPage } from '@/pages/MediaShows';
import { MediaShowDetailPage } from '@/pages/MediaShowDetail';
import { MediaMusicPage } from '@/pages/MediaMusic';
import { MediaMusicArtistPage } from '@/pages/MediaMusicArtist';
import { DocumentsPage } from '@/pages/Documents';
import { AudiobooksPage } from '@/pages/Audiobooks';
import { AudiobookDetailPage } from '@/pages/AudiobookDetail';
import { FilesPage } from '@/pages/Files';
import { UploadPage } from '@/pages/Upload';
import { SettingsPage } from '@/pages/Settings';
import { NotFoundPage } from '@/pages/NotFound';
import { authClient } from '@/hooks/useAuth';
import { queryClient } from '@/query-client';
import { userQueries } from '@/api/users';

// Auth check helper — also triggers auto-provisioning via /api/v1/users/me
async function requireAuth() {
  const session = await authClient.getSession();
  if (!session.data) {
    throw redirect({ to: '/login' });
  }

  // Fetch user profile (triggers backend auto-provisioning if needed).
  // Uses fetchQuery so the result is cached — components can read it
  // via useQuery(userQueries.me()) without a redundant network call.
  // Non-blocking: if this fails (network, backend down), don't prevent navigation.
  try {
    await queryClient.fetchQuery(userQueries.me());
  } catch {
    // Profile fetch failed — the app will still render. Individual pages
    // handle their own service errors. The profile will be retried on
    // next navigation via staleTime expiry.
  }
}

async function requireGuest() {
  const session = await authClient.getSession();
  if (session.data) {
    throw redirect({ to: '/photos' });
  }
}

// Root route
const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

// Auth routes (no layout)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => requireGuest(),
  component: LoginPage,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  beforeLoad: () => requireGuest(),
  component: SignupPage,
});

// Authenticated layout wrapper
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: () => requireAuth(),
  component: () => (
    <ErrorBoundary>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </ErrorBoundary>
  ),
});

// Index redirect
const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/photos' });
  },
});

// Photos
const photosRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/photos',
  component: PhotosPage,
});

// Media
const mediaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/media',
  beforeLoad: () => {
    throw redirect({ to: '/media/movies' });
  },
});

const mediaMoviesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/media/movies',
  component: MediaMoviesPage,
});

const mediaShowsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/media/shows',
  component: MediaShowsPage,
});

const mediaShowDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/media/shows/$showId',
  component: MediaShowDetailPage,
});

const musicRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/music',
  component: MediaMusicPage,
});

const musicArtistRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/music/$artistId',
  component: MediaMusicArtistPage,
});

// Documents
const documentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/documents',
  component: DocumentsPage,
});

// Audiobooks
const audiobooksRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/audiobooks',
  component: AudiobooksPage,
});

const audiobookDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/audiobooks/$bookId',
  component: AudiobookDetailPage,
});

// Files
const filesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/files',
  component: FilesPage,
});

// Upload
const uploadRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/upload',
  component: UploadPage,
});

// Settings
const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/settings',
  component: SettingsPage,
});

// Router tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  appLayoutRoute.addChildren([
    indexRoute,
    photosRoute,
    mediaRoute,
    mediaMoviesRoute,
    mediaShowsRoute,
    mediaShowDetailRoute,
    musicRoute,
    musicArtistRoute,
    documentsRoute,
    audiobooksRoute,
    audiobookDetailRoute,
    filesRoute,
    uploadRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
