import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';

describe('Header component', () => {
  it('shows the title of the conversation being read', () => {
    render(<Header title="ما معنى التوحيد؟" onToggleSidebar={() => {}} onNewChat={() => {}} />);
    expect(screen.getByText('ما معنى التوحيد؟')).toBeDefined();
  });

  it('opens the sidebar from the menu button and starts a new question', () => {
    const handleToggle = vi.fn();
    const handleNewChat = vi.fn();
    render(<Header title="سؤال جديد" onToggleSidebar={handleToggle} onNewChat={handleNewChat} />);

    fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    fireEvent.click(screen.getByRole('button', { name: 'سؤال جديد' }));

    expect(handleToggle).toHaveBeenCalledTimes(1);
    expect(handleNewChat).toHaveBeenCalledTimes(1);
  });
});
