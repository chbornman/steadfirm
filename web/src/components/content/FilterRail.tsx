import {
  type ReactNode,
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useRef,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Select, Input } from 'antd';
import type { IconWeight } from '@phosphor-icons/react';
import {
  SortAscending,
  Heart,
  Tag,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { RAIL_ICON_SIZE, RAIL_COLLAPSED_WIDTH, RAIL_TOP, RAIL_SPRING } from './constants';

/**
 * Floating right-side filter rail.
 *
 * Renders a vertical strip of icon buttons. Clicking an icon expands it to
 * reveal the associated filter control (select, toggle, search, etc.).
 * Only one filter can be expanded at a time (accordion behaviour).
 *
 * The rail floats over the content and does not affect document flow,
 * making it easy to auto-hide in the future.
 */

// ─── Context ─────────────────────────────────────────────────────────

interface FilterRailContextValue {
  openKey: string | null;
  toggle: (key: string) => void;
}

const FilterRailContext = createContext<FilterRailContextValue>({
  openKey: null,
  toggle: () => {},
});

// ─── Root ────────────────────────────────────────────────────────────

interface FilterRailProps {
  children: ReactNode;
}

export function FilterRail({ children }: FilterRailProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback((key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  // Close on click outside
  useEffect(() => {
    if (openKey === null) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenKey(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openKey]);

  // Close on Escape
  useEffect(() => {
    if (openKey === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenKey(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openKey]);

  return (
    <FilterRailContext.Provider value={{ openKey, toggle }}>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={RAIL_SPRING}
        style={{
          position: 'fixed',
          right: 12,
          top: RAIL_TOP,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: 4,
          borderRadius: 12,
          background: 'var(--ant-color-bg-container)',
          border: '1px solid var(--ant-color-border)',
          boxShadow: 'var(--sf-shadow-card)',
        }}
      >
        {children}
      </motion.div>
    </FilterRailContext.Provider>
  );
}

// ─── Generic filter item ────────────────────────────────────────────

interface FilterItemProps {
  /** Unique key for accordion behaviour */
  filterKey: string;
  /** Icon shown in collapsed state */
  icon: ReactNode;
  /** Tooltip / aria label */
  label: string;
  /** The expanded filter control */
  children: ReactNode;
  /** Whether this filter is "active" (has a non-default value) */
  active?: boolean;
}

function FilterItem({ filterKey, icon, label, children, active }: FilterItemProps) {
  const { openKey, toggle } = useContext(FilterRailContext);
  const isOpen = openKey === filterKey;

  return (
    <div style={{ position: 'relative' }}>
      <motion.button
        layout
        onClick={() => toggle(filterKey)}
        title={label}
        transition={RAIL_SPRING}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: RAIL_COLLAPSED_WIDTH,
          height: RAIL_COLLAPSED_WIDTH,
          border: 'none',
          background: isOpen
            ? 'var(--ant-color-fill-secondary)'
            : active
              ? 'var(--ant-color-fill-quaternary)'
              : 'transparent',
          cursor: 'pointer',
          color: active
            ? 'var(--sf-accent)'
            : isOpen
              ? 'var(--ant-color-text)'
              : 'var(--ant-color-text-secondary)',
          borderRadius: 8,
          padding: 0,
          transition: 'background 150ms ease, color 150ms ease',
        }}
      >
        {icon}
        {/* Active dot indicator */}
        {active && !isOpen && (
          <span
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--sf-accent)',
            }}
          />
        )}
      </motion.button>

      {/* Expanded panel — slides out to the left */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, width: 0, x: 8 }}
            animate={{ opacity: 1, width: 'auto', x: 0 }}
            exit={{ opacity: 0, width: 0, x: 8 }}
            transition={RAIL_SPRING}
            style={{
              position: 'absolute',
              right: RAIL_COLLAPSED_WIDTH + 8,
              top: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              borderRadius: 10,
              background: 'var(--ant-color-bg-container)',
              border: '1px solid var(--ant-color-border)',
              boxShadow: 'var(--sf-shadow-card)',
              padding: '8px 12px',
              minWidth: 160,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ant-color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {label}
            </div>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Pre-built filter types ────────────────────────────────────────

interface SortProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

function Sort<T extends string = string>({ value, onChange, options }: SortProps<T>) {
  return (
    <FilterItem
      filterKey="sort"
      icon={<SortAscending size={RAIL_ICON_SIZE} />}
      label="Sort"
    >
      <Select
        value={value}
        onChange={onChange}
        size="small"
        style={{ width: 170 }}
        options={options}
        popupMatchSelectWidth={false}
      />
    </FilterItem>
  );
}

interface ToggleProps {
  icon?: React.ComponentType<{ size: number; weight: IconWeight }>;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  options?: [string, string]; // [off label, on label]
}

function Toggle({
  icon: Icon = Heart,
  label,
  value,
  onChange,
  options: optionLabels,
}: ToggleProps) {
  const offLabel = optionLabels?.[0] ?? 'All';
  const onLabel = optionLabels?.[1] ?? label;

  return (
    <FilterItem
      filterKey={`toggle-${label}`}
      icon={<Icon size={RAIL_ICON_SIZE} weight={value ? 'fill' : 'regular'} />}
      label={label}
      active={value}
    >
      <Select
        value={value ? 'on' : 'off'}
        onChange={(v) => onChange(v === 'on')}
        size="small"
        style={{ width: 150 }}
        options={[
          { value: 'off', label: offLabel },
          { value: 'on', label: onLabel },
        ]}
      />
    </FilterItem>
  );
}

interface TagsProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: { value: string; label: string }[];
  label?: string;
}

function Tags({ value, onChange, options, label = 'Tags' }: TagsProps) {
  return (
    <FilterItem
      filterKey="tags"
      icon={<Tag size={RAIL_ICON_SIZE} />}
      label={label}
      active={value.length > 0}
    >
      <Select
        mode="multiple"
        value={value}
        onChange={onChange}
        size="small"
        placeholder={`Filter by ${label.toLowerCase()}`}
        allowClear
        style={{ width: 200 }}
        maxTagCount="responsive"
        options={options}
        popupMatchSelectWidth={false}
      />
    </FilterItem>
  );
}

interface SearchProps {
  onSearch: (value: string) => void;
  placeholder?: string;
}

function Search({ onSearch, placeholder = 'Search...' }: SearchProps) {
  return (
    <FilterItem
      filterKey="search"
      icon={<MagnifyingGlass size={RAIL_ICON_SIZE} />}
      label="Search"
    >
      <Input.Search
        placeholder={placeholder}
        size="small"
        allowClear
        onSearch={onSearch}
        style={{ width: 200 }}
      />
    </FilterItem>
  );
}

// ─── Compound export ────────────────────────────────────────────────

FilterRail.Item = FilterItem;
FilterRail.Sort = Sort;
FilterRail.Toggle = Toggle;
FilterRail.Tags = Tags;
FilterRail.Search = Search;
