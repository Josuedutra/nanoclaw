'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorCallout } from './ErrorCallout';
import { TASK_TEMPLATES } from '@/lib/task-templates';

interface Product {
  id: string;
  name: string;
  status: string;
}

interface CreateTaskFormProps {
  products: Product[];
  onClose: () => void;
}

const TASK_TYPES = [
  'FEATURE', 'BUG', 'EPIC', 'SECURITY', 'REVOPS',
  'OPS', 'RESEARCH', 'CONTENT', 'DOC', 'INCIDENT',
] as const;

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
const GATES = ['None', 'Security', 'RevOps', 'Claims', 'Product'] as const;
const SCOPES = ['PRODUCT', 'COMPANY'] as const;

async function writeAction(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok?: boolean; taskId?: string; error?: string }> {
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

export function CreateTaskForm({ products, onClose }: CreateTaskFormProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const initialTemplate = TASK_TEMPLATES['FEATURE'];
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState<string>('FEATURE');
  const [priority, setPriority] = useState<string>('P2');
  const [scope, setScope] = useState<string>('PRODUCT');
  const [productId, setProductId] = useState<string>('');
  const [gate, setGate] = useState<string>(initialTemplate?.gate || 'None');
  const [assignedGroup, setAssignedGroup] = useState(initialTemplate?.assignedGroup || '');
  const [description, setDescription] = useState('');
  const [dodChecklist, setDodChecklist] = useState<string[]>(initialTemplate?.dodChecklist || []);
  const [templateApplied, setTemplateApplied] = useState(!!initialTemplate);

  const activeProducts = products.filter((p) => p.status !== 'killed');

  function applyTemplate(type: string) {
    const template = TASK_TEMPLATES[type];
    if (template) {
      setGate(template.gate);
      setAssignedGroup(template.assignedGroup);
      setDodChecklist(template.dodChecklist);
      setTemplateApplied(true);
    } else {
      setGate('None');
      setAssignedGroup('');
      setDodChecklist([]);
      setTemplateApplied(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body: Record<string, unknown> = {
        title,
        task_type: taskType,
        priority,
        scope,
        gate,
      };
      if (scope === 'PRODUCT' && productId) body.product_id = productId;
      if (assignedGroup) body.assigned_group = assignedGroup;
      if (description) body.description = description;
      if (dodChecklist.length > 0) {
        body.metadata = { dodChecklist };
      }

      const result = await writeAction('/api/write/tasks/create', body);
      if (result.ok && result.taskId) {
        router.push(`/tasks/${result.taskId}`);
      } else {
        setError(result.error || 'Task creation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded border border-zinc-700 bg-zinc-900 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">New Task</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>

      {error && <ErrorCallout message={error} />}

      {/* Title */}
      <div>
        <label className="mb-1 block text-xs text-zinc-400">
          Title <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          required
          placeholder="Task title"
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
        />
      </div>

      {/* Row: Type + Priority */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Type <span className="text-red-400">*</span>
          </label>
          <select
            value={taskType}
            onChange={(e) => {
              setTaskType(e.target.value);
              applyTemplate(e.target.value);
            }}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row: Scope + Product */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Scope</label>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              if (e.target.value === 'COMPANY') setProductId('');
            }}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Product {scope === 'PRODUCT' && <span className="text-red-400">*</span>}
          </label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            disabled={scope === 'COMPANY'}
            required={scope === 'PRODUCT'}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            <option value="">
              {scope === 'COMPANY' ? 'N/A' : 'Select product'}
            </option>
            {activeProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row: Gate + Assigned Group */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Gate
            {templateApplied && (
              <span className="ml-1 text-blue-400">(preset)</span>
            )}
          </label>
          <select
            value={gate}
            onChange={(e) => setGate(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
          >
            {GATES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Assigned Group
            {templateApplied && (
              <span className="ml-1 text-blue-400">(preset)</span>
            )}
          </label>
          <input
            type="text"
            value={assignedGroup}
            onChange={(e) => setAssignedGroup(e.target.value)}
            placeholder="Optional"
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs text-zinc-400">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={3}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm placeholder-zinc-500"
        />
      </div>

      {/* DoD Checklist preview */}
      {dodChecklist.length > 0 && (
        <div>
          <label className="mb-1 block text-xs text-zinc-400">
            Definition of Done (from template)
          </label>
          <ul className="space-y-1 rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
            {dodChecklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 text-zinc-600">&#9744;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !title || (scope === 'PRODUCT' && !productId)}
          className="rounded bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Task'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
