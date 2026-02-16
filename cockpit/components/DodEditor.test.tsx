import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DodEditor } from './DodEditor';

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// Mock sessionStorage
const sessionStorageMock = { getItem: vi.fn(() => 'test-csrf') };
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function okResponse() {
  return Promise.resolve({
    json: () => Promise.resolve({ ok: true }),
  });
}

function errorResponse(error: string) {
  return Promise.resolve({
    json: () => Promise.resolve({ error }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const ITEMS = [
  { id: 'dod-aaa', text: 'Write unit tests', done: false },
  { id: 'dod-bbb', text: 'Update docs', done: true },
  { id: 'dod-ccc', text: 'Code review', done: false },
];

describe('DodEditor', () => {
  // === Rendering ===

  it('renders initial items with checkboxes', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    expect(screen.getByText('Update docs')).toBeInTheDocument();
    expect(screen.getByText('Code review')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('renders empty state with add input', () => {
    render(<DodEditor taskId="t1" initialItems={[]} />);
    expect(screen.getByPlaceholderText(/New DoD item/)).toBeInTheDocument();
    expect(screen.getByText('+ Add')).toBeInTheDocument();
  });

  // === Add Item ===

  it('adds a new item when clicking + Add', () => {
    render(<DodEditor taskId="t1" initialItems={[ITEMS[0]]} />);
    const input = screen.getByPlaceholderText(/New DoD item/);
    fireEvent.change(input, { target: { value: 'New requirement' } });
    fireEvent.click(screen.getByText('+ Add'));

    expect(screen.getByText('New requirement')).toBeInTheDocument();
    // Input cleared after add
    expect(input).toHaveValue('');
    // Save button appears (dirty)
    expect(screen.getByText('Save DoD')).toBeInTheDocument();
  });

  it('adds a new item on Enter key', () => {
    render(<DodEditor taskId="t1" initialItems={[]} />);
    const input = screen.getByPlaceholderText(/New DoD item/);
    fireEvent.change(input, { target: { value: 'Enter item' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Enter item')).toBeInTheDocument();
  });

  it('rejects text shorter than 4 chars (Add button stays disabled)', () => {
    render(<DodEditor taskId="t1" initialItems={[]} />);
    const input = screen.getByPlaceholderText(/New DoD item/);
    fireEvent.change(input, { target: { value: 'ab' } });

    const addBtn = screen.getByText('+ Add');
    expect(addBtn).toBeDisabled();
  });

  // === Remove Item ===

  it('removes an item when clicking X', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    const removeBtns = screen.getAllByLabelText('Remove item');
    // Remove second item ("Update docs")
    fireEvent.click(removeBtns[1]);

    expect(screen.queryByText('Update docs')).not.toBeInTheDocument();
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    expect(screen.getByText('Code review')).toBeInTheDocument();
    expect(screen.getByText('Save DoD')).toBeInTheDocument();
  });

  // === Reorder ===

  it('moves an item up', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    // Move "Update docs" (index 1) up
    const upBtns = screen.getAllByLabelText('Move up');
    fireEvent.click(upBtns[1]); // second item's up button

    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0]).toHaveTextContent('Update docs');
    expect(listItems[1]).toHaveTextContent('Write unit tests');
  });

  it('moves an item down', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    // Move "Write unit tests" (index 0) down
    const downBtns = screen.getAllByLabelText('Move down');
    fireEvent.click(downBtns[0]); // first item's down button

    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0]).toHaveTextContent('Update docs');
    expect(listItems[1]).toHaveTextContent('Write unit tests');
  });

  it('disables up button for first item', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    const upBtns = screen.getAllByLabelText('Move up');
    expect(upBtns[0]).toBeDisabled();
  });

  it('disables down button for last item', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    const downBtns = screen.getAllByLabelText('Move down');
    expect(downBtns[downBtns.length - 1]).toBeDisabled();
  });

  // === Toggle ===

  it('toggles item done state', () => {
    render(<DodEditor taskId="t1" initialItems={[ITEMS[0]]} />);
    // Initially "Write unit tests" is done=false -> count 0/1
    expect(screen.getByText('0/1')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Check item'));
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('Save DoD')).toBeInTheDocument();
  });

  // === Inline Edit ===

  it('enters inline edit mode on text click', () => {
    render(<DodEditor taskId="t1" initialItems={[ITEMS[0]]} />);
    fireEvent.click(screen.getByText('Write unit tests'));
    // Should show an input with the current text
    const input = screen.getByDisplayValue('Write unit tests');
    expect(input).toBeInTheDocument();
  });

  it('commits edit on Enter', () => {
    render(<DodEditor taskId="t1" initialItems={[ITEMS[0]]} />);
    fireEvent.click(screen.getByText('Write unit tests'));
    const input = screen.getByDisplayValue('Write unit tests');

    fireEvent.change(input, { target: { value: 'Write integration tests' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Write integration tests')).toBeInTheDocument();
    expect(screen.queryByText('Write unit tests')).not.toBeInTheDocument();
  });

  it('cancels edit on Escape', () => {
    render(<DodEditor taskId="t1" initialItems={[ITEMS[0]]} />);
    fireEvent.click(screen.getByText('Write unit tests'));
    const input = screen.getByDisplayValue('Write unit tests');

    fireEvent.change(input, { target: { value: 'Changed text' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    expect(screen.queryByText('Changed text')).not.toBeInTheDocument();
  });

  it('rejects edit shorter than 4 chars (reverts to original)', () => {
    render(<DodEditor taskId="t1" initialItems={[ITEMS[0]]} />);
    fireEvent.click(screen.getByText('Write unit tests'));
    const input = screen.getByDisplayValue('Write unit tests');

    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Original text preserved
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
  });

  // === Save ===

  it('saves items via fetch and shows no error on success', async () => {
    mockFetch.mockImplementationOnce(okResponse);
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);

    // Make dirty by toggling first unchecked item
    const checkBtns = screen.getAllByLabelText('Check item');
    fireEvent.click(checkBtns[0]);
    fireEvent.click(screen.getByText('Save DoD'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/write/tasks/dod');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.taskId).toBe('t1');
    expect(body.dodChecklist).toHaveLength(3);
    expect(body.dodChecklist[0].id).toBe('dod-aaa');
    expect(body.dodChecklist[0].text).toBe('Write unit tests');
  });

  it('shows ErrorCallout on save failure', async () => {
    mockFetch.mockImplementationOnce(() => errorResponse('Version conflict'));
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);

    // Make dirty
    const checkBtns = screen.getAllByLabelText('Check item');
    fireEvent.click(checkBtns[0]);
    fireEvent.click(screen.getByText('Save DoD'));

    await waitFor(() => {
      expect(screen.getByText(/Version conflict/)).toBeInTheDocument();
    });
  });

  it('shows ErrorCallout on network error', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network down')));
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);

    const checkBtns = screen.getAllByLabelText('Check item');
    fireEvent.click(checkBtns[0]);
    fireEvent.click(screen.getByText('Save DoD'));

    await waitFor(() => {
      expect(screen.getByText(/Network down/)).toBeInTheDocument();
    });
  });

  // === No Save button when clean ===

  it('does not show Save button when no changes made', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    expect(screen.queryByText('Save DoD')).not.toBeInTheDocument();
  });

  // === DnD Drag Handles ===

  it('renders drag handles for each item', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    const handles = screen.getAllByLabelText('Drag to reorder');
    expect(handles).toHaveLength(3);
  });

  it('does not render drag handles when no items', () => {
    render(<DodEditor taskId="t1" initialItems={[]} />);
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument();
  });

  it('up/down buttons still work alongside DnD handles', () => {
    render(<DodEditor taskId="t1" initialItems={ITEMS} />);
    // Verify both mechanisms exist together
    expect(screen.getAllByLabelText('Drag to reorder')).toHaveLength(3);
    expect(screen.getAllByLabelText('Move up')).toHaveLength(3);
    expect(screen.getAllByLabelText('Move down')).toHaveLength(3);

    // Up/down still functional
    const upBtns = screen.getAllByLabelText('Move up');
    fireEvent.click(upBtns[1]);
    const listItems = screen.getAllByRole('listitem');
    expect(listItems[0]).toHaveTextContent('Update docs');
    expect(listItems[1]).toHaveTextContent('Write unit tests');
  });
});
