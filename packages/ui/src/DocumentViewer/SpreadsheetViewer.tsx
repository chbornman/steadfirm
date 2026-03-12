import { useEffect, useState, useMemo } from 'react';
import { Button, Typography, Divider, Tag, Grid, Spin, Table } from 'antd';
import { DownloadSimple } from '@phosphor-icons/react';
import { cssVar } from '@steadfirm/theme';

const { useBreakpoint } = Grid;

export interface SpreadsheetViewerProps {
  downloadUrl: string;
  document: {
    title: string;
    correspondent?: string;
    tags: string[];
    dateCreated: string;
    originalFileName?: string;
  };
  onDownload: () => void;
}

/** Parse CSV text into rows of string arrays. Handles quoted fields with commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(current.trim());
      current = '';
    } else if (ch === '\n') {
      row.push(current.trim());
      current = '';
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
    } else if (ch !== '\r') {
      current += ch;
    }
  }

  // Push final row
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

export function SpreadsheetViewer({ downloadUrl, document, onDownload }: SpreadsheetViewerProps) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [rawContent, setRawContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchContent() {
      try {
        const resp = await fetch(downloadUrl);
        if (!resp.ok) {
          throw new Error(`Failed to fetch document (${resp.status})`);
        }
        const text = await resp.text();
        if (!cancelled) {
          setRawContent(text);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document');
          setLoading(false);
        }
      }
    }

    void fetchContent();
    return () => { cancelled = true; };
  }, [downloadUrl]);

  const { columns, dataSource, rowCount } = useMemo(() => {
    if (!rawContent) return { columns: [], dataSource: [], rowCount: 0 };

    const rows = parseCsv(rawContent);
    if (rows.length === 0) return { columns: [], dataSource: [], rowCount: 0 };

    // First row is the header
    const headerRow = rows[0] as string[];
    const cols = headerRow.map((header, idx) => ({
      title: header || `Column ${idx + 1}`,
      dataIndex: `col_${idx}`,
      key: `col_${idx}`,
      ellipsis: true,
    }));

    const data = rows.slice(1).map((row, rowIdx) => {
      const record: Record<string, string> = { key: String(rowIdx) };
      headerRow.forEach((_header, colIdx) => {
        record[`col_${colIdx}`] = row[colIdx] ?? '';
      });
      return record;
    });

    return { columns: cols, dataSource: data, rowCount: rows.length - 1 };
  }, [rawContent]);

  const metadataPanel = (
    <div
      style={{
        flex: isMobile ? undefined : '0 0 30%',
        minWidth: isMobile ? undefined : 240,
        maxWidth: isMobile ? undefined : 320,
        padding: 20,
        borderLeft: isMobile ? undefined : '1px solid var(--ant-color-border)',
        borderBottom: isMobile ? '1px solid var(--ant-color-border)' : undefined,
        overflow: 'auto',
      }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {document.title}
      </Typography.Title>

      {document.correspondent && (
        <Typography.Text
          type="secondary"
          style={{ display: 'block', marginTop: 8, fontSize: 13 }}
        >
          {document.correspondent}
        </Typography.Text>
      )}

      <Divider style={{ margin: '16px 0' }} />

      <div style={{ marginBottom: 12 }}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          Date
        </Typography.Text>
        <div style={{ marginTop: 4, fontSize: 14 }}>
          {new Date(document.dateCreated).toLocaleDateString()}
        </div>
      </div>

      {document.originalFileName && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            File
          </Typography.Text>
          <div style={{ marginTop: 4, fontSize: 14, wordBreak: 'break-all' }}>
            {document.originalFileName}
          </div>
        </div>
      )}

      {rowCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Rows
          </Typography.Text>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            {rowCount.toLocaleString()} ({columns.length} columns)
          </div>
        </div>
      )}

      {document.tags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              display: 'block',
              marginBottom: 8,
            }}
          >
            Tags
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {document.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        </div>
      )}

      <Divider style={{ margin: '16px 0' }} />

      <Button
        type="primary"
        icon={<DownloadSimple size={16} weight="bold" />}
        onClick={onDownload}
        block
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: cssVar.accent,
        }}
      >
        Download
      </Button>
    </div>
  );

  const tableContent = (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--ant-color-border)',
          flexShrink: 0,
          fontSize: 13,
          color: 'var(--ant-color-text-secondary)',
        }}
      >
        {rowCount > 0 && (
          <span>
            {rowCount.toLocaleString()} rows &middot; {columns.length} columns
          </span>
        )}
      </div>

      {/* Table content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          background: 'var(--ant-color-bg-layout)',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        )}
        {error && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ant-color-error)' }}>
            {error}
          </div>
        )}
        {rawContent != null && columns.length > 0 && (
          <Table
            columns={columns}
            dataSource={dataSource}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            bordered
            style={{ fontSize: 13 }}
          />
        )}
        {rawContent != null && columns.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
            No data found in file
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        height: '100%',
        minHeight: 0,
      }}
    >
      {isMobile && metadataPanel}
      {tableContent}
      {!isMobile && metadataPanel}
    </div>
  );
}
