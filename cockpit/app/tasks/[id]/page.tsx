import Link from 'next/link';
import { opsFetch } from '@/lib/ops-fetch';
import { Badge } from '@/components/Badge';
import { ErrorCallout } from '@/components/ErrorCallout';
import { TaskActions } from '@/components/TaskActions';
import { DodEditor } from '@/components/DodEditor';
import { EvidencePanel } from '@/components/EvidencePanel';
import { CommentsPanel } from '@/components/CommentsPanel';

interface Task {
  id: string;
  title: string;
  description: string | null;
  state: string;
  priority: string;
  task_type: string;
  product: string | null;
  product_id: string | null;
  scope: string;
  assigned_group: string | null;
  executor: string | null;
  created_by: string;
  gate: string;
  dod_required: number;
  version: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface Activity {
  id: number;
  task_id: string;
  action: string;
  from_state: string | null;
  to_state: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let task: Task;
  let activities: Activity[];

  try {
    task = await opsFetch<Task>(`/ops/tasks/${encodeURIComponent(id)}`);
  } catch (err) {
    return (
      <ErrorCallout
        message={
          err instanceof Error ? err.message : 'Failed to load task'
        }
      />
    );
  }

  try {
    activities = await opsFetch<Activity[]>(
      `/ops/tasks/${encodeURIComponent(id)}/activities`,
    );
  } catch {
    activities = [];
  }

  // Parse metadata for DoD checklist, evidence, docsUpdated
  let dodItems: { id?: string; text: string; done: boolean }[] = [];
  let evidence: { link: string; note: string; addedAt: string }[] = [];
  let docsUpdated = false;
  if (task.metadata) {
    try {
      const meta = JSON.parse(task.metadata);
      // Prefer dodStatus (has done flags) over dodChecklist (text-only)
      if (Array.isArray(meta.dodStatus)) {
        dodItems = meta.dodStatus.filter(
          (i: unknown): i is { id?: string; text: string; done: boolean } =>
            !!i && typeof i === 'object' && 'text' in i && 'done' in i,
        );
      } else if (Array.isArray(meta.dodChecklist)) {
        dodItems = meta.dodChecklist
          .filter((item: unknown): item is string => typeof item === 'string')
          .map((text: string) => ({ text, done: false }));
      }
      if (Array.isArray(meta.evidence)) {
        evidence = meta.evidence.filter(
          (e: unknown): e is { link: string; note: string; addedAt: string } =>
            !!e && typeof e === 'object' && 'link' in e,
        );
      }
      if (typeof meta.docsUpdated === 'boolean') {
        docsUpdated = meta.docsUpdated;
      }
    } catch {
      // malformed metadata — ignore
    }
  }

  const fields = [
    ['Type', task.task_type],
    ['State', task.state],
    ['Priority', task.priority],
    ['Scope', task.scope],
    ['Product', task.product || '-'],
    ['Gate', task.gate],
    ['Assigned', task.assigned_group || '-'],
    ['Created By', task.created_by],
    ['Version', String(task.version)],
    ['Created', task.created_at],
    ['Updated', task.updated_at],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/tasks"
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          &larr; Tasks
        </Link>
        <h2 className="mt-1 text-xl font-bold">{task.title}</h2>
        {task.description && (
          <p className="mt-1 text-sm text-zinc-400">{task.description}</p>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {fields.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-zinc-500">{label}</div>
            <div>
              {['State', 'Priority'].includes(label!) ? (
                <Badge value={value!} />
              ) : (
                value
              )}
            </div>
          </div>
        ))}
      </div>

      {/* DoD Checklist (editable) */}
      <DodEditor taskId={task.id} initialItems={dodItems} />

      {/* Evidence & Docs */}
      <EvidencePanel
        taskId={task.id}
        initialEvidence={evidence}
        docsUpdated={docsUpdated}
        taskType={task.task_type}
      />

      {/* Task Actions */}
      <TaskActions
        taskId={task.id}
        state={task.state}
        gate={task.gate}
        version={task.version}
      />

      {/* Comments */}
      <CommentsPanel taskId={task.id} activities={activities} />

      {/* Activities */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-400">
          Activity Log ({activities.length})
        </h3>
        {activities.length === 0 ? (
          <p className="text-sm text-zinc-500">No activities recorded</p>
        ) : (
          <div className="space-y-2">
            {activities.map((a) => (
              <div
                key={a.id}
                className="rounded border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.action}</span>
                  {a.from_state && a.to_state && (
                    <span className="text-zinc-500">
                      {a.from_state} → {a.to_state}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-600">
                    {a.actor} &middot; {a.created_at}
                  </span>
                </div>
                {a.reason && (
                  <div className="mt-1 text-zinc-400">{a.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
