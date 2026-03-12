import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Typography, Spin, Progress, Grid } from 'antd';
import { BookOpenText } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { cssVar, slideUp } from '@steadfirm/theme';
import { readingQueries } from '@/api/reading';

const { useBreakpoint } = Grid;

export function ReadingDetailPage() {
  const params = useParams({ strict: false });
  const seriesId = params.seriesId ?? '';
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  const { data: series, isLoading } = useQuery(readingQueries.detail(seriesId));

  // Fetch the continue point so we know which chapter to open
  const { data: continueChapter } = useQuery({
    ...readingQueries.continuePoint(seriesId),
    enabled: !!series,
  });

  const handleRead = () => {
    if (!continueChapter) return;
    void navigate({
      to: `/reading/${seriesId}/read`,
      search: { chapterId: String(continueChapter.id) },
    });
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!series) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Typography.Text type="secondary">Series not found</Typography.Text>
      </div>
    );
  }

  const progress = series.pages > 0 ? series.pagesRead / series.pages : 0;

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
          src={series.coverUrl}
          alt={series.name}
          style={{
            width: isMobile ? 180 : 240,
            aspectRatio: '2 / 3',
            borderRadius: 8,
            objectFit: 'cover',
            boxShadow: cssVar.shadowElevated,
          }}
        />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0, textAlign: isMobile ? 'center' : 'left' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {series.name}
          </Typography.Title>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 14, display: 'block', marginTop: 4 }}
          >
            {series.format}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13, display: 'block', marginTop: 8 }}
          >
            {series.pages.toLocaleString()} pages
          </Typography.Text>

          {/* Progress */}
          {series.pagesRead > 0 && (
            <div
              style={{
                marginTop: 16,
                maxWidth: 300,
                margin: isMobile ? '16px auto 0' : '16px 0 0',
              }}
            >
              <Progress
                percent={Math.round(progress * 100)}
                strokeColor={cssVar.accent}
                size="small"
              />
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', marginTop: 4 }}
              >
                {series.pagesRead.toLocaleString()} of {series.pages.toLocaleString()} pages read
              </Typography.Text>
            </div>
          )}

          {/* Read button */}
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
              icon={<BookOpenText size={18} weight="fill" />}
              onClick={handleRead}
              disabled={!continueChapter}
              loading={!continueChapter && !!series}
              style={{
                height: 48,
                paddingInline: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: cssVar.accent,
                width: isMobile ? '100%' : undefined,
              }}
            >
              {progress > 0 ? 'Continue Reading' : 'Start Reading'}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
