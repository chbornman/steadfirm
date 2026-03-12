# Steadfirm — Web Frontend Specification

This document specifies the browser-based web frontend (`web/`) and the shared TypeScript packages (`packages/`). It covers architecture, dependencies, every page and component, data fetching, state management, animation, and the build/dev setup.

The web frontend is an **online-only** React SPA. It talks exclusively to the Steadfirm backend API (`/api/v1/*`) and BetterAuth (`/api/auth/*`). It never communicates directly with Immich, Jellyfin, Paperless-ngx, or Audiobookshelf.

### Design Philosophy

**Content is the interface.** Photos, movie posters, album covers, book covers — the user's own media is the visual texture of the app. The UI chrome (header, controls, navigation) stays minimal and recedes. Every layout decision prioritizes showing more artwork at larger sizes with less surrounding decoration.

---

## 1. Tech Stack

| Concern | Choice | Version | Why |
|---------|--------|---------|-----|
| Framework | React | 19 | Concurrent features, use hook |
| Build | Vite | 6 | Fast HMR, ESM-native, Bun-compatible |
| Runtime / PM | Bun | latest | Workspace support, fast installs, native TS |
| UI library | Ant Design | 5 | Complete component set, ConfigProvider theming, good defaults |
| Icons | Phosphor Icons | `@phosphor-icons/react` | Six weights (thin→duotone), tree-shakeable, consistent aesthetic |
| Routing | TanStack Router | latest | Type-safe routes, loader/search params, file-based option |
| Server state | TanStack Query | 5 | Caching, pagination, infinite queries, background refetch, mutations |
| Client state | Zustand | 5 | Lightweight, no boilerplate, middleware (persist, devtools) |
| HTTP client | ky | latest | Tiny fetch wrapper, hooks (beforeRequest/afterResponse), retries, timeout |
| Video/audio player | Vidstack | `@vidstack/react` | HLS-native (hls.js), headless mode, Media Session API, chapters, quality selection |
| Photo grid | react-photo-album | latest | Justified, masonry, rows layouts, virtualization-ready |
| PDF viewer | react-pdf | latest | Canvas/SVG rendering, page navigation, zoom, text selection |
| Animation | framer-motion | latest | Layout animations, mount/unmount transitions, gesture support, spring physics |
| Date | dayjs | latest | Ant Design peer dependency, lightweight |
| Auth client | BetterAuth React | `@better-auth/react` | Session hooks, signIn/signUp/signOut helpers |
| Linting | ESLint | 9 | Flat config, react/hooks/typescript rules |
| Type checking | TypeScript | 5.7+ | Strict mode, `noUncheckedIndexedAccess` |

---

## 2. Monorepo Structure

```
steadfirm/
  package.json              ← Bun workspace root
  bunfig.toml               ← Bun configuration
  tsconfig.base.json        ← Shared TS compiler options

  packages/
    shared/                 ← @steadfirm/shared
      package.json
      tsconfig.json
      src/
        index.ts
        types/
          api.ts            ← Request/response types for every endpoint
          models.ts         ← Domain models (Photo, Movie, Document, etc.)
          auth.ts           ← Session, User types
        constants.ts        ← Service names, route paths, limits, defaults
        validation.ts       ← Shared validation (file size limits, allowed MIME types)

    ui/                     ← @steadfirm/ui
      package.json
      tsconfig.json
      src/
        index.ts
        PhotoGrid/
        VideoPlayer/
        MusicPlayer/
        AudiobookPlayer/
        DocumentViewer/
        DropZone/
        FileList/

    theme/                  ← @steadfirm/theme
      package.json
      tsconfig.json
      src/
        index.ts
        tokens.ts           ← Color palette, spacing scale, typography, radii, shadows
        antd-theme.ts       ← Ant Design ConfigProvider theme token overrides (dark + light)
        motion.ts           ← Animation constants: durations, easings, spring configs
        global.css          ← CSS reset, custom properties, font imports, theme variables

  web/                      ← Browser app (online-only)
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx              ← React root, providers (QueryClient, Router, AntD ConfigProvider, Auth, Theme)
      router.tsx            ← TanStack Router route tree
      api/
        client.ts           ← ky instance with auth interceptor
        photos.ts           ← Photo query/mutation functions
        media.ts            ← Media query/mutation functions
        documents.ts        ← Document query/mutation functions
        audiobooks.ts       ← Audiobook query/mutation functions
        files.ts            ← Files query/mutation functions
        upload.ts           ← Drop zone upload + confirm functions
      hooks/
        useAuth.ts          ← BetterAuth session hook (thin wrapper)
        useTheme.ts         ← Dark/light/system mode hook + persistence
        useIntersection.ts  ← IntersectionObserver for infinite scroll sentinel
      stores/
        music-player.ts     ← Zustand: queue, shuffle, repeat, current track
        audiobook-player.ts ← Zustand: current book, chapter, position, speed, bookmarks
        theme.ts            ← Zustand: dark | light | system, persisted to localStorage
      layouts/
        AppLayout.tsx       ← Authenticated shell: top tab header, content area, persistent players
        AuthLayout.tsx      ← Unauthenticated shell: centered card for login/signup
      pages/
        Login.tsx
        Signup.tsx
        Photos.tsx
        Media.tsx
        MediaMovies.tsx
        MediaShows.tsx
        MediaShowDetail.tsx
        MediaMusic.tsx
        MediaMusicArtist.tsx
        Documents.tsx
        Audiobooks.tsx
        AudiobookDetail.tsx
        Files.tsx
        Upload.tsx          ← Drop zone page
        NotFound.tsx
```

### Workspace Configuration

Root `package.json`:
```json
{
  "name": "steadfirm",
  "private": true,
  "workspaces": ["packages/*", "web"]
}
```

Package cross-references:
- `web` depends on `@steadfirm/shared`, `@steadfirm/ui`, `@steadfirm/theme`
- `@steadfirm/ui` depends on `@steadfirm/shared`, `@steadfirm/theme`
- `@steadfirm/shared` has zero internal dependencies
- `@steadfirm/theme` has zero internal dependencies

---

## 3. Authentication

### BetterAuth Integration

The web frontend uses `@better-auth/react` to interact with the BetterAuth sidecar at `/api/auth/*`. Caddy proxies this path to the BetterAuth container.

**Session management:**
- BetterAuth sets an HTTP-only session cookie on sign-in
- The cookie is sent automatically with every request (same origin)
- No manual token management needed in the browser
- `ky` instance includes `credentials: 'include'` to send cookies

**Auth flow:**
1. App loads → `useSession()` hook checks for existing session
2. No session → redirect to `/login`
3. User signs in via BetterAuth (`signIn.email()` or `signIn.social({ provider: "google" })`)
4. BetterAuth creates session → cookie set → redirect to `/`
5. Axum backend validates the session cookie by reading the `session` table in Postgres

**Route protection:**
- TanStack Router `beforeLoad` guards check session state
- Unauthenticated users are redirected to `/login`
- Authenticated users accessing `/login` or `/signup` are redirected to `/`

### Pages

**Login (`/login`)**
- Clean centered card on a dark background
- Steadfirm logo + wordmark above the form
- Email + password form (Ant Design `Form`, `Input`, `Button`)
- "Sign in with Google" button (Phosphor `GoogleLogo` icon)
- Link to `/signup`
- Error display for invalid credentials
- Subtle amber accent on the primary button and focus states

**Signup (`/signup`)**
- Same layout as login
- Name, email, password, confirm password
- "Sign up with Google" button
- Link to `/login`
- After signup, user is automatically signed in and redirected

---

## 4. Layout

### Design Principles

1. **Horizontal navigation, not sidebar.** Every pixel of horizontal space goes to content. A thin top header with tab navigation maximizes the area for photo grids, poster grids, and album art.
2. **Full-bleed content.** Grids extend edge-to-edge. No max-width container constraining visual content. Only text-heavy views (document detail, audiobook detail) use constrained widths for readability.
3. **Dark-first, theme-aware.** Dark backgrounds make artwork pop. Light mode available for daytime/document use. System preference respected by default.
4. **Persistent playback.** Music and audiobook player bars live at the bottom, always accessible, surviving page navigation.

### AppLayout (authenticated)

```
┌────────────────────────────────────────────────────────────────┐
│  ◆ Steadfirm   Photos  Media  Documents  Audiobooks  Files  ⬆ 👤 ◐ │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                                                                │
│                    Full-bleed content area                      │
│                                                                │
│           Photo grids, poster grids, album art, tables         │
│           edge-to-edge — the content IS the interface          │
│                                                                │
│                                                                │
│                                                                │
│                                                                │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  🎵  Track Title — Artist       ◂  ▮▮  ▸     ━━━━●━━━   3:42  │
└────────────────────────────────────────────────────────────────┘
```

**Header** — single row, 56px tall, fixed to top:
- **Left:** Steadfirm logo (small mark + wordmark). The amber accent color appears here.
- **Center:** Tab navigation — text labels with Phosphor icons (light weight). Tabs: Photos, Media, Documents, Audiobooks, Files. Active tab indicated by an amber bottom border (2px) and bolder text weight. Inactive tabs are muted neutral text.
- **Right:** Upload button (Phosphor `CloudArrowUp`, ghost style), user avatar (Ant Design `Dropdown` → sign out, theme toggle), theme toggle (Phosphor `Sun`/`Moon`/`Desktop` icon cycling dark→light→system).

The header has a subtle `backdrop-filter: blur(12px)` with a semi-transparent background, so content scrolls underneath it. This maintains the immersive feel while keeping navigation accessible.

**Content area** — fills the viewport below the header, above the player bar. Scrolls independently. Content components manage their own padding — grids go edge-to-edge, text content adds horizontal padding.

**Player bar** — fixed to bottom, 64px tall when active, hidden when nothing is playing. Slides up with a spring animation on first play. See section 8 for details.

### Mobile Layout (< 768px)

On narrow viewports, the header tabs move to a **bottom tab bar** (icons only, labels hidden). The header simplifies to just the logo and user avatar. The player bar sits above the bottom tabs.

```
┌──────────────────────────┐
│  ◆ Steadfirm          👤 │
├──────────────────────────┤
│                          │
│   Full-bleed content     │
│                          │
├──────────────────────────┤
│  🎵 Track — Artist ▮▮ ▸  │  ← player bar (compact)
├──────────────────────────┤
│ 🖼  🎬  📄  🎧  📁  ⬆  │  ← bottom tabs (icons)
└──────────────────────────┘
```

### AuthLayout (unauthenticated)

Minimal centered layout. Dark background. No header, no tabs. Just the auth card with logo, form fields, and accent-colored buttons. A subtle radial gradient or warm vignette effect behind the card.

---

## 5. Routing

TanStack Router with the following route tree:

```
/                         → redirect to /photos
/login                    → Login.tsx          (AuthLayout)
/signup                   → Signup.tsx         (AuthLayout)

/photos                   → Photos.tsx         (AppLayout)
/media                    → redirect to /media/movies
/media/movies             → MediaMovies.tsx    (AppLayout)
/media/shows              → MediaShows.tsx     (AppLayout)
/media/shows/$showId      → MediaShowDetail.tsx (AppLayout)
/media/music              → MediaMusic.tsx     (AppLayout)
/media/music/$artistId    → MediaMusicArtist.tsx (AppLayout)
/documents                → Documents.tsx      (AppLayout)
/audiobooks               → Audiobooks.tsx     (AppLayout)
/audiobooks/$bookId       → AudiobookDetail.tsx (AppLayout)
/files                    → Files.tsx          (AppLayout)
/upload                   → Upload.tsx         (AppLayout)
```

All `AppLayout` routes are protected — `beforeLoad` checks session, redirects to `/login` if unauthenticated.

The Media section has a sub-navigation (Ant Design `Segmented` control) for Movies / Shows / Music, rendered at the top of the content area in each Media page.

---

## 6. Data Fetching

### API Client (`web/src/api/client.ts`)

A `ky` instance configured with:
- `prefixUrl`: `''` (same origin — Caddy routes `/api/*` to the backend)
- `credentials`: `'include'` (send session cookie)
- `hooks.afterResponse`: handle 401 → redirect to `/login`
- `retry`: 2 retries for GET requests, 0 for mutations
- `timeout`: 30 seconds (longer for uploads)

```ts
import ky from 'ky';

export const api = ky.create({
  prefixUrl: '',
  credentials: 'include',
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
```

### Query Functions

Each API module (`api/photos.ts`, `api/media.ts`, etc.) exports query functions that return `QueryOptions` objects for use with TanStack Query. This pattern keeps query keys, fetch functions, and types co-located.

```ts
// api/photos.ts
import type { PhotoListResponse, Photo } from '@steadfirm/shared';
import { api } from './client';

export const photoQueries = {
  list: (page?: number) => ({
    queryKey: ['photos', 'list', { page }],
    queryFn: () => api.get('api/v1/photos', { searchParams: { page } }).json<PhotoListResponse>(),
  }),
  detail: (id: string) => ({
    queryKey: ['photos', 'detail', id],
    queryFn: () => api.get(`api/v1/photos/${id}`).json<Photo>(),
  }),
};
```

### Infinite Queries

Photos, movies, shows, documents, and audiobooks all use `useInfiniteQuery` for paginated loading with seamless infinite scroll. The backend returns a cursor or page number for the next page.

```ts
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['photos', 'list', filters],
  queryFn: ({ pageParam }) =>
    api.get('api/v1/photos', { searchParams: { page: pageParam, ...filters } }).json<PhotoListResponse>(),
  getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
  initialPageParam: 1,
});
```

**Infinite scroll mechanics:**

An `IntersectionObserver` watches a sentinel `<div>` placed 2-3 viewport heights before the actual end of the grid. This triggers `fetchNextPage` early enough that new content loads before the user reaches the bottom — creating a seamless, never-ending scroll experience. New items animate in with a staggered fade-up (see section 10).

The sentinel div is invisible and positioned using a CSS grid row at the end of the content. `isFetchingNextPage` shows a subtle loading indicator (small Ant Design `Spin`) below the grid only if the fetch takes more than 300ms (avoids flicker on fast connections).

### Mutations

Write operations (favorite, upload, delete, progress sync) use `useMutation` with optimistic updates where appropriate:

```ts
const toggleFavorite = useMutation({
  mutationFn: (id: string) => api.put(`api/v1/photos/${id}/favorite`).json(),
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['photos'] });
    queryClient.setQueryData(['photos', 'detail', id], (old: Photo) => ({
      ...old,
      isFavorite: !old.isFavorite,
    }));
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
});
```

### Image/Thumbnail URLs

Photo thumbnails, document thumbnails, movie posters, and audiobook covers are served as binary responses from the backend. These are loaded as standard `<img>` tags with the API URL as `src`. The session cookie is sent automatically.

```
/api/v1/photos/:id/thumbnail
/api/v1/media/:id/image
/api/v1/documents/:id/thumbnail
/api/v1/audiobooks/:id/cover
```

Since these are same-origin requests and the session is a cookie, no special auth handling is needed for image loading.

---

## 7. Pages

### Content Presentation Principles

These principles apply to every page:

1. **Artwork dominance.** Imagery takes up the majority of screen space. Text metadata is secondary — smaller, muted, below or overlaid on the artwork.
2. **No card chrome on media grids.** Posters, album covers, and photos render directly — no card borders, no shadows, no background panels. The image IS the element. Minimal rounded corners (4px) on images for a polished feel.
3. **Hover reveals.** Additional info (title, play button, favorite heart) appears on hover with a quick fade. On touch devices, this info is always visible as a subtle overlay at the bottom of the image.
4. **Dense but breathable.** Grid gaps are tight (6-8px) to maximize content density, but consistent to avoid feeling cramped.
5. **Scroll position preservation.** Navigating to a detail view (drawer/page) and returning always restores the exact scroll position in the grid.

### 7.1 Photos (`/photos`)

**Data:** `useInfiniteQuery` → `GET /api/v1/photos` (paginated)

**Layout:**
- Thin filter bar pinned below the header: sort (date taken newest/oldest), filter (favorites only, date range via Ant Design `DatePicker.RangePicker`), total count display. The filter bar is minimal — a single row of controls, not a toolbar.
- Below the filters: full-bleed justified photo grid (`react-photo-album` in `rows` layout)
- Target row height: ~220px on desktop, ~160px on mobile. `react-photo-album` calculates justified widths per row.
- Grid gap: 4px — tight, like Google Photos. Photos fill the viewport edge-to-edge.
- Infinite scroll with early prefetch (sentinel placed 2 viewport heights ahead)

**Photo grid behavior:**
- Thumbnails loaded from `/api/v1/photos/:id/thumbnail` as `<img>` with `loading="lazy"`
- Each photo fades in with a staggered animation as it enters the viewport (framer-motion `whileInView`)
- Video items show a small Phosphor `Play` circle badge in the bottom-right corner
- **Hover (desktop):** subtle brightness increase, a small heart icon (Phosphor `Heart`) in the top-right corner for favoriting, gentle shadow lift
- **Tap/click:** opens Ant Design `Image.PreviewGroup` lightbox
  - Images: full-resolution from `/api/v1/photos/:id/original`
  - Videos: Vidstack player in the lightbox, streaming from `/api/v1/photos/:id/video`

**Actions:**
- Heart icon on hover → toggle favorite (optimistic mutation, heart fills with amber accent on favorite)

### 7.2 Media — Movies (`/media/movies`)

**Data:** `useInfiniteQuery` → `GET /api/v1/media/movies` (paginated)

**Layout:**
- Sub-nav: Ant Design `Segmented` control — **Movies** | Shows | Music — pinned below the header. Pill-style with amber accent on the active segment.
- Sort controls inline with the segmented control (right-aligned): title A-Z, date added, year
- Poster grid: CSS grid, 2:3 aspect ratio images. No card wrappers — raw poster images with 4px border radius.
  - Desktop: ~180px wide posters, auto-fill columns
  - Grid gap: 8px horizontal, 16px vertical (extra vertical space for the title text below)
  - Poster source: `/api/v1/media/:id/image`
  - Below each poster: title (medium weight, one line, truncated) and year (muted, small)
- Infinite scroll

**Hover (desktop):**
- Poster scales to 1.05x with a 200ms ease-out transition
- A subtle dark gradient overlay fades in from the bottom
- A Phosphor `Play` circle icon appears centered on the poster
- The title below becomes fully visible (un-truncated) if it was truncated

**Click behavior:**
- Click poster → Ant Design `Drawer` slides in from the right (480px wide on desktop, full-screen on mobile). The grid remains visible behind, slightly dimmed.
  - Top: large backdrop/poster image (fills drawer width)
  - Below: title (large), year, runtime, rating badge
  - Synopsis/overview paragraph
  - Prominent "Play" button (amber accent, full-width) → opens Vidstack video player inline in the drawer. The drawer expands to accommodate the 16:9 video player above the metadata.
  - HLS stream from `/api/v1/media/:id/stream`
- Closing the drawer restores the grid with scroll position intact.

### 7.3 Media — Shows (`/media/shows`)

**Data:** `useInfiniteQuery` → `GET /api/v1/media/shows` (paginated)

**Layout:**
- Same sub-nav and poster grid as Movies (2:3 ratio, same sizing, same hover)
- Below each poster: show title, year range (e.g., "2020–2024"), season count
- Infinite scroll

**Click behavior:**
- Click poster → navigate to `/media/shows/$showId` (full page, not drawer — shows have too much nested content for a drawer)

### 7.4 Media — Show Detail (`/media/shows/$showId`)

**Data:**
- `useQuery` → `GET /api/v1/media/$showId` (show metadata)
- `useQuery` → `GET /api/v1/media/shows/$showId/seasons` (season list)
- `useQuery` → `GET /api/v1/media/shows/$showId/seasons/$seasonId/episodes` (episode list, triggered on season select)

**Layout:**
- **Hero section:** Full-width backdrop image (blurred and darkened) with show poster overlaid on the left, title + year + overview on the right. Constrainted max-width for readability (900px). The hero has a gradient fade to the page background at the bottom.
- **Season selector:** Ant Design `Segmented` or horizontal pill buttons — Season 1, Season 2, etc. Amber accent on active.
- **Episode list:** Below the season selector. Each episode is a horizontal row:
  - Episode thumbnail (16:9, ~200px wide) on the left
  - Episode number + title (medium weight), runtime, one-line overview on the right
  - Hover: thumbnail brightens slightly, a play icon appears on it
  - Click episode → Drawer with Vidstack video player (same pattern as movie drawer)
- Back button (Phosphor `ArrowLeft`) in the top-left of the hero navigates back to `/media/shows`

### 7.5 Media — Music (`/media/music`)

**Data:** `useInfiniteQuery` → `GET /api/v1/media/music/artists` (paginated)

**Layout:**
- Same sub-nav (Movies | Shows | **Music**)
- Artist grid: CSS grid, 1:1 square aspect ratio. Artist images with full rounded corners (50% border-radius — circular). Artist name centered below in medium weight.
  - Desktop: ~160px diameter circles, auto-fill
  - Grid gap: 16px horizontal, 24px vertical
  - Image source: `/api/v1/media/:id/image`
  - Artists without images: neutral placeholder circle with Phosphor `MusicNote` icon
- Infinite scroll

**Hover:** Circle scales 1.05x, artist name shifts from muted to full contrast.

**Click:** Navigate to `/media/music/$artistId`

### 7.6 Media — Artist Detail (`/media/music/$artistId`)

**Data:**
- `useQuery` → `GET /api/v1/media/music/artists/$artistId/albums`
- `useQuery` → `GET /api/v1/media/music/albums/$albumId/tracks` (triggered on album expand/click)

**Layout:**
- **Artist header:** Large circular artist image (200px) centered or left-aligned, artist name large, album count muted below. Constrained width (800px max).
- **Album list:** Vertical stack of album entries. Each album:
  - Cover art (square, ~120px) on the left
  - Album name (medium weight), year, track count on the right
  - "Play Album" button (ghost style, amber accent) — queues all tracks
  - Clicking the album row expands to reveal the track list (Ant Design `Collapse`, animated with framer-motion)
- **Track list** (expanded):
  - Each track: track number (muted), title, duration (right-aligned)
  - Hover: row highlights with a subtle amber tint, play icon appears at the track number position
  - Click track → dispatches to Zustand music player store: sets track as current, queues the remaining album tracks after it
  - Currently playing track: amber accent on the track number, subtle animated equalizer icon

### 7.7 Documents (`/documents`)

**Data:** `useInfiniteQuery` → `GET /api/v1/documents` (paginated)

This is the most "utility" section. Less visual, more functional. But still clean and polished.

**Layout:**
- Filter bar: sort (date added, title, correspondent), tag filter (Ant Design `Select` with multi-select and search). Compact single row.
- Document grid: CSS grid of document cards. Unlike media grids, documents use a light card treatment — subtle border (1px, theme-appropriate), 8px border radius, slight shadow on hover.
  - Card content: document thumbnail from `/api/v1/documents/:id/thumbnail` (fills card top, ~3:4 aspect ratio), title below (medium weight, 2 lines max), correspondent (muted, small), date, tag chips (Ant Design `Tag`, small, muted colors)
  - Desktop: ~200px wide cards, auto-fill columns
  - Grid gap: 12px
- Infinite scroll

**Hover:** Card lifts with a subtle shadow increase and border becomes slightly more visible.

**Click behavior:**
- Click card → Ant Design `Drawer` slides in from the right (720px wide on desktop, full-screen on mobile):
  - Left portion (70%): PDF viewer (`react-pdf`) rendering from `/api/v1/documents/:id/preview`. Page navigation (prev/next + page number input), zoom controls.
  - Right portion (30%): metadata panel — title, correspondent, tags (editable in future), dates, page count. Download button (Phosphor `DownloadSimple`, amber accent).
  - On mobile: metadata panel stacks above the PDF viewer as a collapsible section.

### 7.8 Audiobooks (`/audiobooks`)

**Data:** `useInfiniteQuery` → `GET /api/v1/audiobooks` (paginated)

**Layout:**
- Sort controls: title, author, recently listened. Filter: "In progress" toggle.

- **"Continue Listening" hero section** (visible when the user has in-progress books):
  - Horizontal scrollable row of book covers with progress indicators.
  - Each item: large book cover (~140px wide, 2:3 ratio), title below, author muted, thin amber progress bar at the bottom of the cover showing % complete.
  - The currently active book (if playing) has a subtle glow/ring around its cover.
  - Click → navigate to `/audiobooks/$bookId`
  - Horizontal scroll: CSS `overflow-x: auto` with `scroll-snap-type: x mandatory`, thin custom scrollbar (amber thumb).

- **Full library grid** below: same poster-grid style as movies. 2:3 book covers, no card chrome.
  - Cover source: `/api/v1/audiobooks/:id/cover`
  - Below each cover: title (medium weight), author (muted)
  - Partial-progress books show an amber progress bar at the cover bottom edge
  - Infinite scroll

**Hover:** Same as movie posters — scale 1.05x, Phosphor `Headphones` icon centered on cover.

**Click:** Navigate to `/audiobooks/$bookId`

### 7.9 Audiobook Detail (`/audiobooks/$bookId`)

**Data:**
- `useQuery` → `GET /api/v1/audiobooks/$bookId` (metadata, chapters, progress)

**Layout:** Constrained width (800px max), centered.
- **Book hero:** Large cover image (240px wide) on the left, metadata on the right:
  - Title (large, bold)
  - Author, narrator (muted)
  - Total duration (formatted: "12h 34m")
  - Progress: "6h 12m remaining" with an amber progress bar
- **Controls row:**
  - Large "Play" / "Resume" button (amber accent, prominent)
  - Playback speed selector: Ant Design `Segmented` — 0.75x, 1x, 1.25x, 1.5x, 2x
  - Bookmark button (Phosphor `BookmarkSimple`)
- **Chapter list:** Below the controls. Ant Design `List` styled cleanly:
  - Each row: chapter number (muted), chapter title, duration (right-aligned)
  - Active/current chapter: amber left border, slightly highlighted background
  - Completed chapters: muted text, small Phosphor `Check` icon
  - Click chapter → jump to chapter start in playback

**Playback:**
- Clicking play dispatches to the audiobook Zustand store
- Vidstack (headless) manages the HLS audio stream
- The persistent audiobook player bar appears at the bottom (see section 8)
- Progress synced to backend every 30 seconds via `PATCH /api/v1/audiobooks/:id/progress`

### 7.10 Files (`/files`)

**Data:** `useInfiniteQuery` → `GET /api/v1/files` (paginated)

The simplest section. Pure utility — a file manager for things that didn't classify elsewhere.

**Layout:**
- Sort controls: date, name, size, type
- Ant Design `Table` with columns:
  - Icon: Phosphor icon based on MIME type (e.g., `FileImage`, `FileVideo`, `FileDoc`, `FileZip`, `File`)
  - Filename (primary text)
  - Type (human-readable MIME, muted)
  - Size (formatted: KB, MB, GB)
  - Date uploaded (relative: "3 days ago", full date on hover tooltip)
  - Actions: Phosphor `DownloadSimple` button, Phosphor `Trash` button (with Ant Design `Popconfirm`), "Reclassify" dropdown (Ant Design `Dropdown` → move to Photos/Media/Documents/Audiobooks)

The table uses Ant Design's built-in pagination at the bottom (or infinite scroll if the list is long).

### 7.11 Upload / Drop Zone (`/upload`)

**Data:** `useMutation` → `POST /api/v1/upload` (per-file)

A three-step flow, all on the same page. Steps transition with framer-motion `AnimatePresence`. Classification happens **instantly in the browser** using filename, MIME type, and file size — no server round-trip needed before the user sees suggestions.

**Step 1 — Select Files:**
- Large drop area centered in the content space (constrained to 600px max width, centered vertically and horizontally)
- Ant Design `Upload.Dragger` styled to match the theme: dashed border (neutral, becomes amber on drag-over), Phosphor `CloudArrowUp` icon (large, 48px, amber), "Drop files here or click to browse" text
- Supports multiple files, any type
- On file selection: files appear immediately in a stacked list below the drop area with classification suggestions (no upload yet — classification uses the browser's `File` object: `name`, `type`, `size`)

**Step 2 — Classification Review:**
- Transitions in immediately after files are selected (instant — no upload wait)
- Each file shown as a horizontal row (framer-motion `layoutId` for smooth position transition):
  - File icon (MIME-based Phosphor icon), filename, size
  - Suggested destination: Ant Design `Tag` with service color (Photos=blue, Media=purple, Documents=green, Audiobooks=amber, Files=neutral-500)
  - Confidence indicator: if > 0.85, shown as a subtle checkmark. If < 0.85, the row has a gentle amber highlight indicating it needs attention.
  - Override: Ant Design `Select` to change destination (only visible on hover or when confidence is low)
- Classification heuristics live in `@steadfirm/shared/validation.ts` (shared with future Tauri app):
  - `.jpg/.heic/.png/.webp/.raw` → Photos (0.95)
  - `.mp4/.mov` < 500MB → Photos (0.90), >= 500MB → Media (0.80)
  - `.mkv/.avi` → Media (0.80)
  - `.m4b` → Audiobooks (0.95)
  - `.mp3/.flac/.ogg` → Media/Music (0.85)
  - `.pdf/.docx` → Documents (0.90)
  - Everything else → Files (1.0)
- "Upload All" button at the bottom (amber accent, prominent) — starts uploading with confirmed destinations

**Step 3 — Uploading:**
- Each file uploads individually via `POST /api/v1/upload` (multipart: file + confirmed service name)
- Per-file progress bars (Ant Design `Progress`, amber accent) via fetch progress events
- Concurrent uploads (3 at a time) for throughput
- Each file row shows: progress bar → checkmark (success) or × (error) with amber/red color
- Files that fail can be retried individually
- "Upload More" button appears when all complete to reset to Step 1 (framer-motion exit/enter animation)

### 7.12 Not Found (`*`)

- Ant Design `Result` with `404` status
- "Page not found" message
- Button to go to Photos (home)

---

## 8. Media Playback

### 8.1 Architecture

All media playback uses Vidstack in **headless mode**. Vidstack manages the underlying `<video>` or `<audio>` element, HLS via `hls.js`, buffering, and the Media Session API. The UI is built entirely with Ant Design components and Phosphor Icons.

Application-level state (queue, shuffle, repeat, current book, chapter) lives in Zustand stores. Media-level state (current time, duration, buffering, playing/paused) comes from Vidstack's reactive state.

**Only one audio context is active at a time.** If the music player is playing and the user starts an audiobook, the music pauses (and vice versa). Video playback in drawers is independent — closing the drawer stops the video.

### 8.2 Video Player

Used for: movies, TV episodes, home videos in the Photos tab.

**Component:** `@steadfirm/ui` exports `<VideoPlayer>` — wraps Vidstack with custom controls.

**Features:**
- HLS adaptive streaming (quality auto-selection, manual override)
- Play/pause, seek, volume, fullscreen
- Custom control bar: Phosphor icons, Ant Design `Slider` for progress, amber accent on progress fill and volume
- Progress bar shows buffer indicator (lighter neutral behind the amber playhead)
- Keyboard shortcuts (space=play/pause, f=fullscreen, arrow keys=seek ±10s, m=mute)
- Rendered inside Ant Design `Drawer` — not a standalone page
- Controls auto-hide after 3s of inactivity, fade back on mouse move

**Stream URL:** `/api/v1/media/:id/stream` (movies/shows) or `/api/v1/photos/:id/video` (home videos)

### 8.3 Music Player

Used for: Jellyfin music tracks.

**State:** `stores/music-player.ts` (Zustand)

```ts
interface MusicPlayerState {
  // Queue
  queue: Track[];
  currentIndex: number;
  shuffledIndices: number[] | null;  // null = shuffle off

  // Playback mode
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;

  // Actions
  play: (track: Track, queue?: Track[]) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setRepeat: (mode: 'off' | 'all' | 'one') => void;
  toggleShuffle: () => void;
  addToQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
}
```

**Shuffle:** Fisher-Yates on the indices array. Preserves original queue order for un-shuffling.

**UI — Persistent Player Bar (64px, fixed bottom):**
The player bar slides up from the bottom (framer-motion spring animation) when the first track starts playing.

- **Left section:** Album art (48px square, 4px radius), track title (medium weight), artist name (muted). Clicking the art/title expands the queue drawer.
- **Center section:** Previous (Phosphor `SkipBack`), play/pause (Phosphor `Pause`/`Play`, larger, amber accent), next (Phosphor `SkipForward`). Below: thin progress bar (Ant Design `Slider`, minimal style, amber fill) with current time / duration.
- **Right section:** Shuffle toggle (Phosphor `Shuffle`, amber when active), repeat toggle (Phosphor `Repeat`/`RepeatOnce`, amber when active), volume (Phosphor `SpeakerHigh`/`SpeakerLow`/`SpeakerSlash` + slider on hover), queue toggle (Phosphor `Queue`).

**Queue Drawer:**
- Ant Design `Drawer` from the bottom, ~50% viewport height
- Scrollable track list with current track highlighted (amber left border)
- Each track: album art (small), title, artist, duration. Hover: remove button
- Drag-to-reorder (future)
- Close drawer: swipe down or click outside

**Audio source:** `/api/v1/media/:id/stream` — Vidstack headless manages the `<audio>` element with HLS.

**Media Session API:** Vidstack registers metadata (title, artist, album, artwork) so OS-level media controls and lock screen work correctly.

### 8.4 Audiobook Player

Used for: Audiobookshelf books.

**State:** `stores/audiobook-player.ts` (Zustand)

```ts
interface AudiobookPlayerState {
  // Current book
  book: Audiobook | null;
  chapters: Chapter[];
  currentChapter: number;

  // Playback
  position: number;          // seconds into the book
  speed: number;             // 0.75, 1, 1.25, 1.5, 2
  isPlaying: boolean;

  // Session
  sessionId: string | null;  // Audiobookshelf playback session ID

  // Actions
  startBook: (book: Audiobook, chapters: Chapter[], resumePosition?: number) => void;
  pause: () => void;
  resume: () => void;
  seekTo: (seconds: number) => void;
  jumpToChapter: (index: number) => void;
  setSpeed: (speed: number) => void;
  stop: () => void;
}
```

**UI — Persistent Mini-Player Bar (same 64px slot as music player):**
- Only one player bar visible at a time. Starting an audiobook replaces the music bar (and vice versa).
- **Left:** Book cover art (48px), book title, current chapter name (muted)
- **Center:** Skip back 30s (Phosphor `Rewind`), play/pause (amber), skip forward 30s (Phosphor `FastForward`). Progress bar below.
- **Right:** Speed indicator button (e.g., "1.5×", cycles through speeds on click), chapter list toggle (Phosphor `ListBullets`), bookmark (Phosphor `BookmarkSimple`)

**Chapter Drawer:**
- Same as queue drawer (bottom drawer, ~50% viewport height)
- Chapter list with current chapter highlighted (amber left border, progress bar within the chapter)
- Click chapter → seek to chapter start

**Progress sync:**
- Every 30 seconds while playing: `PATCH /api/v1/audiobooks/:id/progress`
- On pause/stop: immediate sync
- On resume: fetch latest progress from server first (in case another device updated it)
- Uses TanStack Query mutation with debounce

**Audio source:** Stream URL returned by `POST /api/v1/audiobooks/:id/play` — Vidstack headless manages HLS.

---

## 9. Shared Packages

### 9.1 `@steadfirm/shared`

Zero dependencies. Pure TypeScript types, constants, and validation.

**Types (`types/`):**

```ts
// types/models.ts — Domain models

export interface Photo {
  id: string;
  type: 'image' | 'video';
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  dateTaken: string;          // ISO 8601
  isFavorite: boolean;
  duration?: number;          // seconds, for videos
  thumbnailUrl: string;       // relative: /api/v1/photos/:id/thumbnail
}

export interface Movie {
  id: string;
  title: string;
  year: number;
  runtime: number;            // minutes
  overview: string;
  rating?: string;
  imageUrl: string;
  streamUrl: string;
}

export interface TvShow {
  id: string;
  title: string;
  year: string;               // "2020-2024" or "2020-"
  overview: string;
  seasonCount: number;
  imageUrl: string;
}

export interface Season {
  id: string;
  name: string;
  seasonNumber: number;
  episodeCount: number;
}

export interface Episode {
  id: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  runtime: number;
  overview: string;
  imageUrl: string;
  streamUrl: string;
}

export interface Artist {
  id: string;
  name: string;
  imageUrl: string;
  albumCount: number;
}

export interface Album {
  id: string;
  name: string;
  year: number;
  artistName: string;
  trackCount: number;
  imageUrl: string;
}

export interface Track {
  id: string;
  title: string;
  trackNumber: number;
  duration: number;           // seconds
  artistName: string;
  albumName: string;
  albumImageUrl: string;
  streamUrl: string;
}

export interface Document {
  id: string;
  title: string;
  correspondent?: string;
  tags: string[];
  dateCreated: string;
  dateAdded: string;
  pageCount?: number;
  thumbnailUrl: string;
  previewUrl: string;
  downloadUrl: string;
}

export interface Audiobook {
  id: string;
  title: string;
  author: string;
  narrator?: string;
  duration: number;           // seconds
  coverUrl: string;
  progress?: number;          // seconds listened
}

export interface Chapter {
  id: string;
  title: string;
  start: number;              // seconds
  end: number;                // seconds
}

export interface UserFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
}
```

```ts
// types/api.ts — API response wrappers

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  nextPage: number | null;
}

export type PhotoListResponse = PaginatedResponse<Photo>;
export type MovieListResponse = PaginatedResponse<Movie>;
export type ShowListResponse = PaginatedResponse<TvShow>;
export type DocumentListResponse = PaginatedResponse<Document>;
export type AudiobookListResponse = PaginatedResponse<Audiobook>;
export type FileListResponse = PaginatedResponse<UserFile>;

export interface UploadResponse {
  files: UploadedFileClassification[];
}

export interface UploadedFileClassification {
  uploadId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  suggestedService: 'photos' | 'media' | 'documents' | 'audiobooks' | 'files';
  confidence: number;
}

export interface UploadConfirmRequest {
  files: { uploadId: string; service: string }[];
}
```

**Constants (`constants.ts`):**

```ts
export const SERVICES = ['photos', 'media', 'documents', 'audiobooks', 'files'] as const;
export type ServiceName = typeof SERVICES[number];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  photos: 'Photos',
  media: 'Media',
  documents: 'Documents',
  audiobooks: 'Audiobooks',
  files: 'Files',
};

export const SERVICE_COLORS: Record<ServiceName, string> = {
  photos: '#3B82F6',       // blue
  media: '#8B5CF6',        // purple
  documents: '#22C55E',    // green
  audiobooks: '#D97706',   // amber (matches accent)
  files: '#737373',        // neutral
};

export const API_PREFIX = '/api/v1';
export const AUTH_PREFIX = '/api/auth';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024;  // 10 GB
```

### 9.2 `@steadfirm/ui`

Shared React components. Depends on `@steadfirm/shared` (types) and `@steadfirm/theme` (design tokens). Also depends on `antd`, `@phosphor-icons/react`, `@vidstack/react`, `react-photo-album`, `react-pdf`, `framer-motion`.

All components are **presentation-only** — they accept data and callbacks via props. No data fetching, no direct API calls, no Zustand store access. This ensures they work identically in `web/` and the future Tauri app.

**Components:**

| Component | Props (key) | Description |
|-----------|-------------|-------------|
| `PhotoGrid` | `photos`, `onSelect`, `onLoadMore`, `onFavorite` | Justified grid via `react-photo-album`. Edge-to-edge, 4px gaps. Staggered fade-in on viewport entry. Hover: brightness + heart overlay. Video badge on video items. |
| `PhotoLightbox` | `photos`, `currentIndex`, `onClose` | Ant Design `Image.PreviewGroup` for images. For video items, renders `VideoPlayer` in a modal. |
| `PosterGrid` | `items`, `onSelect`, `onLoadMore`, `aspectRatio?` | Reusable grid for movies, shows, audiobooks. CSS grid, auto-fill columns. Hover: scale 1.05x + icon overlay + gradient. Staggered fade-in. |
| `VideoPlayer` | `src`, `poster?`, `onClose?` | Vidstack headless with custom Ant Design + Phosphor controls. HLS-aware. Auto-hiding controls. Amber accents on progress/volume. |
| `MusicPlayerBar` | `state`, `onAction` | Persistent 64px bottom bar. Spring slide-up entrance. Art, track info, transport controls, progress slider, volume, queue toggle. |
| `MusicQueue` | `queue`, `currentIndex`, `onSelect`, `onRemove` | Bottom drawer content. Track list with amber highlight on current. |
| `AudiobookPlayerBar` | `state`, `onAction` | Persistent 64px bottom bar. Cover, title, chapter, ±30s skip, speed, progress. |
| `AudiobookChapters` | `chapters`, `currentChapter`, `onSelect` | Bottom drawer content. Chapter list with amber highlight and progress indicator on current. |
| `DocumentCard` | `document`, `onClick` | Card with thumbnail, title, correspondent, tags, date. Subtle border and shadow treatment. Hover lift. |
| `DocumentViewer` | `previewUrl`, `document`, `onDownload` | Split view: react-pdf viewer (left) + metadata panel (right). Page nav, zoom. |
| `DropZone` | `onUpload`, `classifications?`, `onConfirm`, `onOverride` | Three-step flow with AnimatePresence transitions. Upload → classify → confirm. |
| `FileTable` | `files`, `onDownload`, `onDelete`, `onReclassify` | Ant Design `Table`. MIME-based Phosphor icon, name, type, size, relative date, action buttons. |

### 9.3 `@steadfirm/theme`

Design tokens, Ant Design theme configuration, and animation constants.

**Design tokens (`tokens.ts`):**

```ts
// --- Color palette ---

export const colors = {
  // Neutral palette (used for backgrounds, text, borders)
  neutral0: '#ffffff',
  neutral50: '#fafafa',
  neutral100: '#f5f5f5',
  neutral200: '#e5e5e5',
  neutral300: '#d4d4d4',
  neutral400: '#a3a3a3',
  neutral500: '#737373',
  neutral600: '#525252',
  neutral700: '#404040',
  neutral800: '#262626',
  neutral900: '#171717',
  neutral950: '#0a0a0a',

  // Accent — warm amber
  accent: '#D97706',          // amber-600: primary accent
  accentLight: '#F59E0B',     // amber-500: hover states, active indicators
  accentDark: '#B45309',      // amber-700: pressed states
  accentSubtle: '#FEF3C7',    // amber-100: subtle backgrounds (light mode)
  accentSubtleDark: '#78350F', // amber-900: subtle backgrounds (dark mode)

  // Semantic
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Service colors (for drop zone tags, classification indicators)
  photos: '#3B82F6',          // blue
  media: '#8B5CF6',           // purple
  documents: '#22C55E',       // green
  audiobooks: '#D97706',      // amber
  files: '#737373',           // neutral
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radii = {
  none: 0,
  sm: 4,       // images, posters, album art
  md: 8,       // cards, inputs, buttons
  lg: 12,      // drawers, modals
  full: 9999,  // circular (artist images, avatar)
};

export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMono: "'JetBrains Mono', 'Fira Code', monospace",
};
```

**Ant Design theme (`antd-theme.ts`):**

```ts
import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import { colors, radii, typography } from './tokens';

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    fontFamily: typography.fontFamily,
    colorPrimary: colors.accent,
    colorLink: colors.accent,
    borderRadius: radii.md,
    colorBgContainer: colors.neutral0,
    colorBgLayout: colors.neutral50,
    colorText: colors.neutral900,
    colorTextSecondary: colors.neutral500,
    colorBorder: colors.neutral200,
  },
  components: {
    Layout: {
      headerBg: 'rgba(255, 255, 255, 0.8)',
      bodyBg: colors.neutral50,
    },
    Menu: {
      itemBg: 'transparent',
      horizontalItemSelectedColor: colors.accent,
      horizontalItemSelectedBg: 'transparent',
    },
    Slider: {
      trackBg: colors.accent,
      trackHoverBg: colors.accentLight,
      handleColor: colors.accent,
      handleActiveColor: colors.accentLight,
    },
    Segmented: {
      itemSelectedBg: colors.accent,
      itemSelectedColor: colors.neutral0,
    },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    fontFamily: typography.fontFamily,
    colorPrimary: colors.accentLight,
    colorLink: colors.accentLight,
    borderRadius: radii.md,
    colorBgContainer: colors.neutral900,
    colorBgLayout: colors.neutral950,
    colorText: colors.neutral100,
    colorTextSecondary: colors.neutral400,
    colorBorder: colors.neutral700,
  },
  components: {
    Layout: {
      headerBg: 'rgba(10, 10, 10, 0.8)',
      bodyBg: colors.neutral950,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'transparent',
      darkItemSelectedColor: colors.accentLight,
    },
    Slider: {
      trackBg: colors.accentLight,
      trackHoverBg: colors.accent,
      handleColor: colors.accentLight,
      handleActiveColor: colors.accent,
    },
    Segmented: {
      itemSelectedBg: colors.accentLight,
      itemSelectedColor: colors.neutral950,
    },
  },
};
```

**Motion constants (`motion.ts`):**

```ts
// Timing — snappy but smooth. Nothing sluggish, nothing jarring.
export const duration = {
  instant: 0.1,         // micro-interactions: icon swaps, state toggles
  fast: 0.15,           // hover effects, fade in/out
  normal: 0.25,         // drawers, tab transitions, content fade
  slow: 0.4,            // page transitions, large layout shifts
  entrance: 0.5,        // first-time element entrances (player bar slide-up)
};

// Easings — mostly ease-out for arrivals, ease-in-out for morphs
export const ease = {
  out: [0.16, 1, 0.3, 1],           // standard deceleration (elements arriving)
  inOut: [0.45, 0, 0.55, 1],        // symmetric (elements morphing)
  spring: { type: 'spring' as const, stiffness: 400, damping: 30 },  // snappy spring (player bar, drawers)
  gentleSpring: { type: 'spring' as const, stiffness: 200, damping: 25 },  // softer (grid items appearing)
};

// Stagger — for grid items appearing sequentially
export const stagger = {
  fast: 0.03,           // photo grid (many items, subtle wave)
  normal: 0.05,         // poster grid, card grid
  slow: 0.08,           // track lists, chapter lists
};
```

**Global CSS (`global.css`):**

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  overflow-x: hidden;
}

/* Theme transition — smooth color changes when switching themes */
body,
body * {
  transition: background-color 0.25s ease, color 0.15s ease, border-color 0.2s ease;
}

/* Opt out of theme transition for elements that need instant changes */
.no-theme-transition,
.no-theme-transition * {
  transition: none !important;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--ant-color-border);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--ant-color-text-quaternary);
}

/* Utility: hide scrollbar but keep scrollable (for horizontal scroll sections) */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
```

---

## 10. Animation & Motion

Animation is core to making Steadfirm feel alive and responsive. Every animation serves a purpose: confirming an action, guiding attention, or smoothing a transition. Nothing decorative or slow.

### Principles

1. **Snappy, not sluggish.** Most animations complete in 150-250ms. The user should never wait for an animation.
2. **Physics-based where possible.** Spring animations for elements entering/exiting (player bar, drawers). They feel more natural than linear or cubic-bezier timing.
3. **Staggered grid entrances.** When a grid of items loads (photos, posters, cards), items fade-up in a quick wave from top-left to bottom-right. This is purely decorative but makes loading feel polished rather than abrupt.
4. **Content-aware.** Animations on media content (hover scale on posters, fade on photo overlays) are gentler and faster than structural animations (drawer open, page transition).
5. **Reduced motion respected.** All animations check `prefers-reduced-motion: reduce` and disable/minimize when set.

### Catalog

| Element | Animation | Duration | Easing | Trigger |
|---------|-----------|----------|--------|---------|
| Grid item (photo/poster/card) | Fade up + scale from 0.97 to 1 | 250ms | `ease.gentleSpring` | Enters viewport (`whileInView`) |
| Grid item stagger | Each item delayed by 30ms | — | — | Batch appearance |
| Poster/cover hover | Scale to 1.05 | 150ms | `ease.out` | Mouse enter |
| Photo hover overlay (heart, brightness) | Opacity 0 → 1 | 150ms | `ease.out` | Mouse enter |
| Tab content switch | Fade out (100ms) → fade in (150ms) | 250ms total | `ease.inOut` | Tab change |
| Drawer open | Slide in from right + fade | 300ms | `ease.spring` | Click trigger |
| Drawer close | Slide out + fade | 200ms | `ease.out` | Close/outside click |
| Player bar entrance | Slide up from bottom | 500ms | `ease.spring` | First track plays |
| Player bar exit | Slide down | 300ms | `ease.out` | Queue empties |
| Favorite heart toggle | Scale pulse (1 → 1.3 → 1) + color fill | 300ms | `ease.spring` | Click |
| Upload file row | Slide in from left + fade | 200ms | `ease.out` | File selected |
| Classification tags | Fade + scale in | 150ms | `ease.out` | Upload complete |
| Drop zone step transition | Exit left + enter right (AnimatePresence) | 300ms | `ease.inOut` | Step advance |
| Infinite scroll new items | Same as grid item entrance | 250ms | `ease.gentleSpring` | New page loads |
| Skeleton → content | Cross-fade (skeleton fades out, content fades in) | 200ms | `ease.inOut` | Data loads |
| Theme switch | Background/text color transition | 250ms | CSS ease | Theme toggle |

### Implementation

Grid stagger animations use framer-motion's `variants` + `staggerChildren`:

```tsx
const gridContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger.fast },
  },
};

const gridItem = {
  hidden: { opacity: 0, y: 8, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: ease.gentleSpring,
  },
};

// Usage in a grid component
<motion.div variants={gridContainer} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-50px' }}>
  {items.map((item) => (
    <motion.div key={item.id} variants={gridItem}>
      {/* poster/photo/card */}
    </motion.div>
  ))}
</motion.div>
```

Hover animations use CSS transitions (not framer-motion) for better performance on large grids:

```css
.poster-image {
  transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.poster-image:hover {
  transform: scale(1.05);
}
```

---

## 11. Responsive Design

### Breakpoints

| Breakpoint | Header | Content | Player | Notes |
|------------|--------|---------|--------|-------|
| `>= 1200px` (xl) | Full tab labels + icons | 6+ photo columns, 6+ poster columns | Full controls | Default desktop experience |
| `>= 992px` (lg) | Full tab labels + icons | 4-5 columns | Full controls | Narrower desktop / small laptop |
| `>= 768px` (md) | Condensed tabs (icons + short labels) | 3-4 columns | Condensed (hide volume, shrink progress) | Tablet landscape |
| `< 768px` (sm/xs) | Logo + avatar only (tabs move to bottom) | 2-3 columns | Compact (art + play/pause + progress) | Mobile — bottom tab bar |

### Mobile-Specific Behavior

- **Bottom tab bar:** 5 tabs (Photos, Media, Docs, Audiobooks, Files) + Upload. Icons only with small labels beneath. Active tab: amber accent icon + label. 56px tall.
- **Player bar stacks:** On mobile, the player bar is above the tab bar. Compact: cover art (36px), title (truncated), play/pause button, thin progress bar. Tap to expand to full-screen player.
- **Drawers become full-screen:** Movie detail, document viewer, queue — all drawers open as full-screen sheets on mobile with a drag-to-close handle at the top.
- **Hover effects disabled:** Touch devices show info overlays (title, play icon) persistently at the bottom of poster/photo items as a subtle gradient.
- **Photo grid adjusts row height:** 160px on mobile (vs. 220px desktop) for denser browsing.
- **Poster grid:** 2 columns on mobile, larger posters relative to screen width.

---

## 12. Theme System

### Three Modes

1. **Dark** — Default. Dark neutral backgrounds (`neutral-950` / `neutral-900`), light text (`neutral-100`), amber accents. Best for media browsing — artwork pops against dark.
2. **Light** — Light neutral backgrounds (`neutral-50` / `white`), dark text (`neutral-900`), slightly deeper amber accents. Better for document reading, daytime use.
3. **System** — Follows `prefers-color-scheme`. Default on first visit.

### State Management

```ts
// stores/theme.ts (Zustand with persist)
interface ThemeState {
  mode: 'dark' | 'light' | 'system';
  resolved: 'dark' | 'light';  // actual applied theme (resolved from system)
  setMode: (mode: 'dark' | 'light' | 'system') => void;
}
```

- Persisted to `localStorage` via Zustand `persist` middleware
- `resolved` computed from `mode` + `window.matchMedia('(prefers-color-scheme: dark)')`
- Changes to system preference trigger a re-resolve
- Ant Design `ConfigProvider` receives `darkTheme` or `lightTheme` based on `resolved`
- `<html>` element gets `data-theme="dark"` or `data-theme="light"` for CSS targeting

### Theme Toggle UI

In the header (desktop) and settings area (mobile): a single button that cycles through Dark → Light → System. Phosphor icons: `Moon` (dark), `Sun` (light), `Desktop` (system). The icon transitions with a quick rotate + fade animation.

---

## 13. Error Handling

### API Errors

The backend returns errors as:

```json
{
  "error": "not_found",
  "message": "Photo not found"
}
```

The `ky` `afterResponse` hook handles:
- **401** → redirect to `/login` (session expired)
- **403** → Ant Design `message.error("You don't have access to this resource")`
- **404** → component-level empty state (Ant Design `Empty`)
- **500+** → Ant Design `message.error("Something went wrong. Please try again.")`

### Loading States

Every page uses Ant Design `Skeleton` components shaped to match the loaded content:
- Photo grid: grid of skeleton rectangles matching justified layout proportions
- Poster grid: grid of 2:3 skeleton rectangles
- Document grid: skeleton cards with thumbnail + text lines
- File table: skeleton table rows
- Detail pages: skeleton blocks matching hero + metadata layout

Skeletons cross-fade to real content (200ms, `ease.inOut`) — no hard pop-in.

### Empty States

When a section has no content:
- Phosphor icon (large, muted, duotone weight): `ImagesSquare` (photos), `FilmSlate` (media), `FileText` (documents), `Headphones` (audiobooks), `Folder` (files)
- Short message: "No photos yet", "Your media library is empty", etc.
- Subtle prompt: "Upload your first files" with a link/button to `/upload`

### Error Boundaries

A top-level React error boundary wraps the router outlet. On crash:
- Renders Ant Design `Result` with `500` status
- "Something went wrong" message
- "Reload" button

---

## 14. Development Setup

### Commands

```bash
# From repo root — install all workspace deps
bun install

# Web frontend dev server (Vite, port 5173)
bun run --cwd web dev

# Lint
bun run --cwd web lint

# Typecheck
bun run --cwd web typecheck

# Build
bun run --cwd web build

# Preview production build
bun run --cwd web preview
```

### Vite Configuration

```ts
// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Auth requests → BetterAuth sidecar (must be listed before /api to match first)
      '/api/auth': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      // All other API requests → Axum backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

In development:
- Vite dev server runs on `http://localhost:5173`
- Caddy doesn't run in dev mode (`profiles: [prod]` in docker-compose), so Vite proxies directly to the services running locally
- `/api/auth/*` requests proxy to BetterAuth at `http://localhost:3002`
- `/api/*` requests proxy to the Axum backend at `http://localhost:3001`
- This mirrors the routing Caddy does in production (see `infra/Caddyfile`)

### ESLint Configuration

```ts
// web/eslint.config.ts
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
```

---

## 15. Docker (Production)

The web frontend is built as a static site and served by Caddy.

**Dockerfile (`infra/Dockerfile.web`):**

```dockerfile
FROM oven/bun:1-alpine AS build
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/theme/package.json packages/theme/
COPY web/package.json web/
RUN bun install --frozen-lockfile

# Copy source and build
COPY packages/ packages/
COPY web/ web/
COPY tsconfig.base.json .
RUN bun run --cwd web build

# Production: no runtime needed — Caddy serves the static files
FROM scratch AS output
COPY --from=build /app/web/dist /web-dist
```

Caddy serves the built static files from a shared volume. The `handle` block in the Caddyfile becomes:

```caddyfile
handle {
    root * /srv/web
    try_files {path} /index.html
    file_server
}
```

`try_files` with `/index.html` fallback enables client-side routing (all paths resolve to the SPA entry point, TanStack Router handles the rest).

---

## 16. Implementation Milestones

These milestones correspond to M4 in the main SPEC.md but are broken into smaller increments.

### M4.1: Scaffold + Auth + Theme
- Monorepo workspace setup (root `package.json`, `bunfig.toml`, `tsconfig.base.json`)
- `@steadfirm/shared` package with types and constants
- `@steadfirm/theme` package with tokens, dark/light Ant Design themes, motion constants, global CSS
- `@steadfirm/ui` package scaffold (empty, builds)
- `web/` Vite + React app with TanStack Router and Query
- Ant Design `ConfigProvider` with dark/light theme switching
- Theme store (Zustand, persisted) + toggle UI
- BetterAuth login + signup pages
- Route protection (redirect to `/login` if unauthenticated)
- `AppLayout` with horizontal tab header, placeholder pages, responsive mobile bottom tabs
- Verify auth flow end-to-end (BetterAuth → session cookie → backend validates)

### M4.2: Photos
- `PhotoGrid` component (`react-photo-album` justified layout, edge-to-edge, staggered fade-in)
- `PhotoLightbox` component (Ant Design `Image.PreviewGroup`)
- Photos page with infinite scroll (`useInfiniteQuery`, early sentinel prefetch)
- Thumbnail loading from backend
- Full-resolution view in lightbox
- Video playback in lightbox (Vidstack)
- Favorite toggle with heart animation

### M4.3: Media — Video
- `PosterGrid` reusable component (2:3 ratio, hover scale, staggered entrance)
- `VideoPlayer` component (Vidstack headless, HLS, custom controls, auto-hide)
- Movies page with poster grid + infinite scroll + sort
- Movie detail drawer (slide-in, poster + metadata + inline player)
- Shows page with poster grid
- Show detail page (hero, season selector, episode list)
- Episode playback in drawer
- Media sub-nav (`Segmented` control)

### M4.4: Media — Music
- Music artist grid (circular images, 1:1)
- Artist detail page (albums, expandable track lists)
- `MusicPlayerBar` component (persistent, spring entrance, full transport controls)
- `MusicQueue` component (bottom drawer)
- Zustand music player store (queue, shuffle, repeat)
- Vidstack headless audio with HLS
- Media Session API integration

### M4.5: Documents + Audiobooks
- `DocumentCard` component (thumbnail + metadata, hover lift)
- `DocumentViewer` component (react-pdf, split view, page nav, zoom)
- Documents page with grid + infinite scroll + sort/filter
- Document viewer drawer
- `AudiobookPlayerBar` component (persistent, ±30s skip, speed control)
- `AudiobookChapters` component (bottom drawer)
- Audiobooks page with "Continue Listening" hero + grid + infinite scroll
- Audiobook detail page (cover, metadata, chapters, play/resume)
- Zustand audiobook player store
- Progress sync to backend (debounced mutation)

### M4.6: Files + Drop Zone
- `FileTable` component (Ant Design Table, MIME icons, actions)
- Files page with table + download/delete/reclassify
- `DropZone` component (three-step flow with AnimatePresence transitions)
- Upload page with drag-and-drop, per-file progress
- Classification review with service tags and confidence indicators
- Confirm/override destination
- Routing progress indicators

### M4.7: Polish + Production
- Loading skeletons for all pages (shaped to match content)
- Skeleton → content cross-fade
- Empty states with icons and upload prompts
- Error states and error boundary
- Responsive testing across breakpoints
- Reduced motion support (`prefers-reduced-motion`)
- Docker build (`infra/Dockerfile.web`)
- Caddy integration (static file serving, SPA fallback)
- End-to-end smoke test with real backend
