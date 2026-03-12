/// <reference lib="dom" />

import { describe, expect, mock, test } from 'bun:test';
import { render, screen, fireEvent } from '@testing-library/react';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  test('renders the brand name', () => {
    render(<Wordmark />);
    expect(screen.getByText('Steadfirm')).toBeInTheDocument();
  });

  test('renders as a button when onClick is provided', () => {
    const handleClick = mock(() => {});
    render(<Wordmark onClick={handleClick} />);
    const el = screen.getByRole('button');
    fireEvent.click(el);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test('applies custom font size', () => {
    render(<Wordmark size={32} />);
    const el = screen.getByText('Steadfirm');
    expect(el.style.fontSize).toBe('32px');
  });

  test('has no button role without onClick', () => {
    render(<Wordmark />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
