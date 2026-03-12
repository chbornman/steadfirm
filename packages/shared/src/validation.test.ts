import { describe, expect, test } from 'bun:test';
import { classifyFile, formatFileSize, formatDuration } from './validation';

describe('classifyFile', () => {
  test('classifies .jpg as photos with high confidence', () => {
    const result = classifyFile('vacation.jpg', 'image/jpeg', 4_000_000);
    expect(result.service).toBe('photos');
    expect(result.confidence).toBe(0.95);
  });

  test('classifies .m4b as audiobooks', () => {
    const result = classifyFile('book.m4b', 'audio/mp4', 500_000_000);
    expect(result.service).toBe('audiobooks');
    expect(result.confidence).toBe(0.98);
  });

  test('classifies .epub as reading', () => {
    const result = classifyFile('novel.epub', 'application/epub+zip', 2_000_000);
    expect(result.service).toBe('reading');
    expect(result.confidence).toBe(0.95);
  });

  test('classifies .pdf as documents with low confidence (ambiguous)', () => {
    const result = classifyFile('paper.pdf', 'application/pdf', 1_000_000);
    expect(result.service).toBe('documents');
    expect(result.confidence).toBe(0.5);
  });

  test('classifies .mp4 as media with low confidence (ambiguous)', () => {
    const result = classifyFile('clip.mp4', 'video/mp4', 100_000_000);
    expect(result.service).toBe('media');
    expect(result.confidence).toBe(0.5);
  });

  test('classifies unknown extension as files with full confidence', () => {
    const result = classifyFile('data.xyz', 'application/octet-stream', 1000);
    expect(result.service).toBe('files');
    expect(result.confidence).toBe(1.0);
  });

  test('falls back to MIME type for unrecognized image extension', () => {
    const result = classifyFile('photo.bmp', 'image/bmp', 5_000_000);
    expect(result.service).toBe('photos');
    expect(result.confidence).toBe(0.9);
  });
});

describe('formatFileSize', () => {
  test('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  test('formats kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  test('formats megabytes', () => {
    expect(formatFileSize(5_242_880)).toBe('5.0 MB');
  });

  test('formats gigabytes', () => {
    expect(formatFileSize(2_684_354_560)).toBe('2.50 GB');
  });
});

describe('formatDuration', () => {
  test('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  test('formats minutes and seconds with padding', () => {
    expect(formatDuration(185)).toBe('3:05');
  });

  test('formats hours and minutes', () => {
    expect(formatDuration(7384)).toBe('2h 3m');
  });
});
