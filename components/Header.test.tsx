import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';

describe('Header component', () => {
  it('renders the header title correctly', () => {
    render(<Header onToggleSidebar={() => {}} onHomeClick={() => {}} />);
    expect(screen.getByText('باحث السلف')).toBeDefined();
  });

  it('triggers onToggleSidebar when the menu button is clicked', () => {
    const handleToggle = vi.fn();
    const { container } = render(<Header onToggleSidebar={handleToggle} onHomeClick={() => {}} />);
    
    // There are two buttons, the first one is the menu button
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });
});
