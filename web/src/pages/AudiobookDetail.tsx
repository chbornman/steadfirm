import { useState, useCallback, useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Segmented, Typography, Spin, Progress, Grid } from 'antd';
import { Play, BookmarkSimple } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { AudiobookChapters } from '@steadfirm/ui';
import { colors, slideUp } from '@steadfirm/theme';
import { formatDuration } from '@steadfirm/shared';
import { audiobookQueries, startPlayback } from '@/api/audiobooks';
import { useAudiobookPlayerStore } from '@/stores/audiobook-player';

const { useBreakpoint } = Grid;

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

export function AudiobookDetailPage() {
  const params = useParams({ strict: false });
  const bookId = params.bookId ?? '';
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [selectedSpeed, setSelectedSpeed] = useState(1);
  const [isStarting, setIsStarting] = useState(false);

  const playerStore = useAudiobookPlayerStore();

  const { data: book, isLoading } = useQuery(audiobookQueries.detail(bookId));

  const currentChapterIndex = useMemo(() => {
    if (!book?.chapters || !book.progress) return 0;
    const position = (book.progress || 0) * book.duration;
    const index = book.chapters.findIndex((ch) => position >= ch.start && position < ch.end);
    return Math.max(0, index);
  }, [book]);

  const handlePlay = useCallback(async () => {
    if (!book) return;
    setIsStarting(true);
    try {
      const session = await startPlayback(book.id);
      const streamUrl = session.audioTracks[0]?.contentUrl ?? '';
      const resumePosition = session.currentTime;
      playerStore.startBook(book, session.chapters, session.sessionId, streamUrl, resumePosition);
      playerStore.setSpeed(selectedSpeed);
    } finally {
      setIsStarting(false);
    }
  }, [book, selectedSpeed, playerStore]);

  const handleChapterSelect = useCallback(
    (index: number) => {
      if (playerStore.book?.id === bookId) {
        playerStore.jumpToChapter(index);
      }
    },
    [playerStore, bookId],
  );

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!book) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Typography.Text type="secondary">Audiobook not found</Typography.Text>
      </div>
    );
  }

  const progress = book.progress ?? 0;
  const isCurrentlyPlaying = playerStore.book?.id === bookId;

  return (
    <motion.div
      variants={slideUp}
      initial="hidden"
      animate="visible"
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: isMobile ? 16 : 32,
      }}
    >
      {/* Hero section */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 20 : 32,
          alignItems: isMobile ? 'center' : 'flex-start',
        }}
      >
        {/* Cover */}
        <img
          src={book.coverUrl}
          alt={book.title}
          style={{
            width: isMobile ? 180 : 240,
            aspectRatio: '2 / 3',
            borderRadius: 8,
            objectFit: 'cover',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0, textAlign: isMobile ? 'center' : 'left' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {book.title}
          </Typography.Title>
          <Typography.Text style={{ fontSize: 16, display: 'block', marginTop: 4 }}>
            {book.author}
          </Typography.Text>
          {book.narrator && (
            <Typography.Text
              type="secondary"
              style={{ fontSize: 14, display: 'block', marginTop: 4 }}
            >
              Narrated by {book.narrator}
            </Typography.Text>
          )}
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13, display: 'block', marginTop: 8 }}
          >
            {formatDuration(book.duration)}
          </Typography.Text>

          {/* Progress */}
          {progress > 0 && (
            <div style={{ marginTop: 16, maxWidth: 300, margin: isMobile ? '16px auto 0' : '16px 0 0' }}>
              <Progress
                percent={Math.round(progress * 100)}
                strokeColor={colors.accent}
                size="small"
              />
            </div>
          )}

          {/* Controls */}
          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: 'center',
              gap: 12,
              marginTop: 24,
            }}
          >
            <Button
              type="primary"
              size="large"
              icon={<Play size={18} weight="fill" />}
              onClick={() => void handlePlay()}
              loading={isStarting}
              style={{
                height: 48,
                paddingInline: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: colors.accent,
                width: isMobile ? '100%' : undefined,
              }}
            >
              {isCurrentlyPlaying ? 'Playing' : progress > 0 ? 'Resume' : 'Play'}
            </Button>

            <Segmented
              value={selectedSpeed}
              onChange={(v) => {
                const speed = typeof v === 'number' ? v : parseFloat(String(v));
                setSelectedSpeed(speed);
                if (isCurrentlyPlaying) {
                  playerStore.setSpeed(speed);
                }
              }}
              options={SPEED_OPTIONS.map((s) => ({
                value: s,
                label: `${s}x`,
              }))}
              size="middle"
            />

            <Button
              icon={<BookmarkSimple size={18} />}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              Bookmark
            </Button>
          </div>
        </div>
      </div>

      {/* Chapters */}
      {book.chapters.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <Typography.Title level={5} style={{ margin: '0 0 12px', padding: '0 16px' }}>
            Chapters
          </Typography.Title>
          <div
            style={{
              border: '1px solid var(--ant-color-border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <AudiobookChapters
              chapters={book.chapters}
              currentChapter={
                isCurrentlyPlaying ? playerStore.currentChapter : currentChapterIndex
              }
              onSelect={handleChapterSelect}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
