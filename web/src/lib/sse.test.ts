import { describe, expect, test } from 'bun:test';
import { parseSSEBuffer, extractPartialObjects } from './sse';

describe('parseSSEBuffer', () => {
  test('parses a complete SSE event', () => {
    const buffer = 'event: classify\ndata: {"file":"test.jpg"}\n\n';
    const { events, remaining } = parseSSEBuffer(buffer);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('classify');
    expect(events[0].data).toBe('{"file":"test.jpg"}');
    expect(remaining).toBe('');
  });

  test('keeps incomplete event as remaining', () => {
    const buffer =
      'event: classify\ndata: {"file":"test.jpg"}\n\nevent: progress\ndata: partial';
    const { events, remaining } = parseSSEBuffer(buffer);
    expect(events).toHaveLength(1);
    expect(remaining).toBe('event: progress\ndata: partial');
  });

  test('defaults event name to "message"', () => {
    const buffer = 'data: hello\n\n';
    const { events } = parseSSEBuffer(buffer);
    expect(events[0].event).toBe('message');
    expect(events[0].data).toBe('hello');
  });

  test('parses multiple events from one buffer', () => {
    const buffer = 'data: first\n\ndata: second\n\n';
    const { events, remaining } = parseSSEBuffer(buffer);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe('first');
    expect(events[1].data).toBe('second');
    expect(remaining).toBe('');
  });

  test('joins multi-line data fields', () => {
    const buffer = 'data: line1\ndata: line2\n\n';
    const { events } = parseSSEBuffer(buffer);
    expect(events[0].data).toBe('line1\nline2');
  });
});

describe('extractPartialObjects', () => {
  test('extracts complete objects from streaming JSON', () => {
    const partial = '{"files": [{"name":"a.jpg","service":"photos"},{"name":"b.mp4"';
    const results = extractPartialObjects<{ name: string }>(partial);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('a.jpg');
  });

  test('returns empty array when no array found', () => {
    expect(extractPartialObjects('{"status": "ok"}')).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(extractPartialObjects('')).toEqual([]);
  });

  test('handles escaped quotes inside strings', () => {
    const json = '[{"name":"file \\"quoted\\".txt"}]';
    const results = extractPartialObjects<{ name: string }>(json);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('file "quoted".txt');
  });
});
