import { useState, useEffect } from 'react';
import { Image, Modal } from 'antd';
import type { Photo } from '@steadfirm/shared';
import { overlay } from '@steadfirm/theme';
import { VideoPlayer } from '../VideoPlayer';

export interface PhotoLightboxProps {
  photos: Photo[];
  currentIndex: number;
  visible: boolean;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  /** Resolve full URL for original image. Defaults to photo.thumbnailUrl replacement with /original */
  getOriginalUrl?: (photo: Photo) => string;
  /** Resolve video stream URL */
  getVideoUrl?: (photo: Photo) => string;
}

const defaultGetOriginalUrl = (photo: Photo) =>
  `/api/v1/photos/${photo.id}/original`;

const defaultGetVideoUrl = (photo: Photo) =>
  `/api/v1/photos/${photo.id}/video`;

export function PhotoLightbox({
  photos,
  currentIndex,
  visible,
  onClose,
  onIndexChange,
  getOriginalUrl = defaultGetOriginalUrl,
  getVideoUrl = defaultGetVideoUrl,
}: PhotoLightboxProps) {
  const [internalIndex, setInternalIndex] = useState(currentIndex);

  useEffect(() => {
    setInternalIndex(currentIndex);
  }, [currentIndex]);

  const currentPhoto = photos[internalIndex];
  const isVideo = currentPhoto?.type === 'video';

  const handleChange = (newIndex: number) => {
    setInternalIndex(newIndex);
    onIndexChange?.(newIndex);
  };

  // For image photos, use Ant Design Image.PreviewGroup
  // For video photos, use a Modal with VideoPlayer
  if (!visible || !currentPhoto) return null;

  if (isVideo) {
    return (
      <Modal
        open={visible}
        onCancel={onClose}
        footer={null}
        width="80vw"
        centered
        destroyOnClose
        styles={{
          body: { padding: 0, background: overlay.bg, borderRadius: 8, overflow: 'hidden' },
        }}
      >
        <VideoPlayer
          src={getVideoUrl(currentPhoto)}
          poster={currentPhoto.thumbnailUrl}
          onClose={onClose}
        />
      </Modal>
    );
  }

  // Image mode: use Ant Design's Image.PreviewGroup
  // We render a hidden group and control its visibility
  const imagePhotos = photos.filter((p) => p.type === 'image');
  const adjustedIndex = imagePhotos.findIndex((p) => p.id === currentPhoto.id);

  return (
    <div style={{ display: 'none' }}>
      <Image.PreviewGroup
        preview={{
          visible,
          onVisibleChange: (vis) => {
            if (!vis) onClose();
          },
          current: adjustedIndex >= 0 ? adjustedIndex : 0,
          onChange: (newIdx) => {
            const photo = imagePhotos[newIdx];
            if (photo) {
              const originalIndex = photos.findIndex((p) => p.id === photo.id);
              if (originalIndex >= 0) handleChange(originalIndex);
            }
          },
        }}
      >
        {imagePhotos.map((photo) => (
          <Image
            key={photo.id}
            src={getOriginalUrl(photo)}
            alt={photo.filename}
          />
        ))}
      </Image.PreviewGroup>
    </div>
  );
}
