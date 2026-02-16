'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ErrorCallout } from './ErrorCallout';

interface DodItem {
  id?: string;
  text: string;
  done: boolean;
}

interface DodEditorProps {
  taskId: string;
  initialItems: DodItem[];
}

let clientIdCounter = 0;
function clientTempId(): string {
  return `dod-tmp-${++clientIdCounter}`;
}

async function writeAction(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; error?: string }> {
  const csrf = sessionStorage.getItem('csrf') || '';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// --- SortableItem sub-component ---

interface SortableItemProps {
  item: DodItem;
  index: number;
  totalItems: number;
  isEditing: boolean;
  editText: string;
  onToggle: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onEditTextChange: (v: string) => void;
}

function SortableItem({
  item,
  index,
  totalItems,
  isEditing,
  editText,
  onToggle,
  onRemove,
  onMoveUp,
  onMoveDown,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onEditTextChange,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id! });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-1">
      {/* Drag handle */}
      <button
        type="button"
        className="flex-shrink-0 cursor-grab px-1 text-xs text-zinc-600 hover:text-zinc-400"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        &#x2630;
      </button>

      {/* Checkbox */}
      <button
        type="button"
        onClick={onToggle}
        className="flex-shrink-0 text-base leading-none"
        aria-label={item.done ? 'Uncheck item' : 'Check item'}
      >
        {item.done ? (
          <span className="text-green-500">&#9745;</span>
        ) : (
          <span className="text-zinc-600">&#9744;</span>
        )}
      </button>

      {/* Text or inline editor */}
      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          onBlur={onCommitEdit}
          maxLength={200}
          autoFocus
          className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-sm"
        />
      ) : (
        <span
          onClick={onStartEdit}
          className={`min-w-0 flex-1 cursor-text rounded px-1 hover:bg-zinc-800 ${
            item.done ? 'text-zinc-500 line-through' : 'text-zinc-300'
          }`}
        >
          {item.text}
        </span>
      )}

      {/* Reorder + remove buttons */}
      <div className="ml-auto flex flex-shrink-0 items-center gap-0.5 text-zinc-600">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="px-1 text-xs hover:text-zinc-400 disabled:opacity-30"
          aria-label="Move up"
          title="Move up"
        >
          &#9650;
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === totalItems - 1}
          className="px-1 text-xs hover:text-zinc-400 disabled:opacity-30"
          aria-label="Move down"
          title="Move down"
        >
          &#9660;
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="px-1 text-xs text-red-600 hover:text-red-400"
          aria-label="Remove item"
          title="Remove"
        >
          &#10005;
        </button>
      </div>
    </li>
  );
}

// --- Main DodEditor ---

export function DodEditor({ taskId, initialItems }: DodEditorProps) {
  const router = useRouter();
  const [items, setItems] = useState<DodItem[]>(
    initialItems.map((i) => ({ ...i, id: i.id || clientTempId() })),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [newText, setNewText] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id);
      const newIndex = prev.findIndex((i) => i.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
    setDirty(true);
  }

  function toggleItem(index: number) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, done: !item.done } : item,
      ),
    );
    setDirty(true);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
    if (editingIdx === index) {
      setEditingIdx(null);
      setEditText('');
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
    if (editingIdx === index) setEditingIdx(target);
    else if (editingIdx === target) setEditingIdx(index);
  }

  function startEdit(index: number) {
    setEditingIdx(index);
    setEditText(items[index].text);
  }

  function commitEdit() {
    if (editingIdx === null) return;
    const trimmed = editText.trim();
    if (trimmed.length >= 4 && trimmed.length <= 200) {
      setItems((prev) =>
        prev.map((item, i) =>
          i === editingIdx ? { ...item, text: trimmed } : item,
        ),
      );
      setDirty(true);
    }
    setEditingIdx(null);
    setEditText('');
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditText('');
  }

  function addItem() {
    const trimmed = newText.trim();
    if (trimmed.length < 4 || trimmed.length > 200) return;
    if (items.length >= 50) return;
    setItems((prev) => [...prev, { id: clientTempId(), text: trimmed, done: false }]);
    setNewText('');
    setDirty(true);
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const result = await writeAction('/api/write/tasks/dod', {
        taskId,
        dodChecklist: items.map((i) => ({
          id: i.id,
          text: i.text,
          done: i.done,
        })),
      });
      if (result.ok) {
        setDirty(false);
        router.refresh();
      } else {
        setError(result.error || 'Save failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const doneCount = items.filter((i) => i.done).length;
  const canAddNew = newText.trim().length >= 4 && newText.trim().length <= 200 && items.length < 50;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-400">
          Definition of Done
        </h3>
        {items.length > 0 && (
          <span className="text-xs text-zinc-500">
            {doneCount}/{items.length}
          </span>
        )}
      </div>

      {error && <ErrorCallout message={error} />}

      {items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id!)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1 rounded border border-zinc-800 bg-zinc-950 p-3 text-sm">
              {items.map((item, i) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={i}
                  totalItems={items.length}
                  isEditing={editingIdx === i}
                  editText={editText}
                  onToggle={() => toggleItem(i)}
                  onRemove={() => removeItem(i)}
                  onMoveUp={() => moveItem(i, -1)}
                  onMoveDown={() => moveItem(i, 1)}
                  onStartEdit={() => startEdit(i)}
                  onCommitEdit={commitEdit}
                  onCancelEdit={cancelEdit}
                  onEditTextChange={setEditText}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Add new item */}
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canAddNew) addItem();
          }}
          placeholder="New DoD item (4-200 chars)"
          maxLength={200}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!canAddNew}
          className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-40"
        >
          + Add
        </button>
      </div>

      {/* Save button */}
      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-2 rounded bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save DoD'}
        </button>
      )}
    </section>
  );
}
