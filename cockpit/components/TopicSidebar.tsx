'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSse, type SseEvent } from '@/lib/use-sse';

export interface Topic {
  id: string;
  group_folder: string;
  title: string;
  created_at: string;
  last_activity: string;
  status: string;
}

interface Agent {
  folder: string;
  label: string;
  color: string;
}

const AGENTS: Agent[] = [
  { folder: 'main', label: 'Coordinator', color: 'bg-blue-500' },
  { folder: 'developer', label: 'Developer', color: 'bg-green-500' },
  { folder: 'security', label: 'Security', color: 'bg-yellow-500' },
];

interface TopicSidebarProps {
  initialTopics: Topic[];
  activeTopicId: string | null;
  onSelectTopic: (topicId: string) => void;
  onNewTopic: (group: string) => void;
}

export function TopicSidebar({
  initialTopics,
  activeTopicId,
  onSelectTopic,
  onNewTopic,
}: TopicSidebarProps) {
  const [topics, setTopics] = useState<Topic[]>(initialTopics);

  // Refresh topics on SSE events
  const handleSseEvent = useCallback((event: SseEvent) => {
    if (event.type === 'chat:message') {
      // Refresh topic list
      fetch('/api/ops/topics')
        .then((r) => r.json())
        .then((data: { topics?: Topic[] }) => {
          if (data.topics) setTopics(data.topics);
        })
        .catch(() => {});
    }
  }, []);

  useSse(handleSseEvent);

  // Also poll every 10s
  useEffect(() => {
    const poll = setInterval(() => {
      fetch('/api/ops/topics')
        .then((r) => r.json())
        .then((data: { topics?: Topic[] }) => {
          if (data.topics) setTopics(data.topics);
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(poll);
  }, []);

  // Group topics by agent folder
  const topicsByAgent = new Map<string, Topic[]>();
  for (const agent of AGENTS) {
    topicsByAgent.set(agent.folder, []);
  }
  for (const topic of topics) {
    const list = topicsByAgent.get(topic.group_folder);
    if (list) {
      list.push(topic);
    } else {
      // Unknown group — put under main
      topicsByAgent.get('main')?.push(topic);
    }
  }

  return (
    <div className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 overflow-y-auto">
      <div className="p-3 text-xs font-bold uppercase text-zinc-500 tracking-wider">
        Agents
      </div>
      {AGENTS.map((agent) => {
        const agentTopics = topicsByAgent.get(agent.folder) || [];
        return (
          <div key={agent.folder} className="mb-2">
            {/* Agent header */}
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className={`h-2 w-2 rounded-full ${agent.color}`} />
              <span className="text-sm font-medium text-zinc-300">
                {agent.label}
              </span>
            </div>

            {/* Topics */}
            {agentTopics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => onSelectTopic(topic.id)}
                className={`w-full text-left px-6 py-1.5 text-sm truncate ${
                  topic.id === activeTopicId
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
                title={topic.title}
              >
                {topic.title}
              </button>
            ))}

            {/* New topic button */}
            <button
              onClick={() => onNewTopic(agent.folder)}
              className="w-full text-left px-6 py-1 text-xs text-zinc-600 hover:text-zinc-400"
            >
              + New Topic
            </button>
          </div>
        );
      })}
    </div>
  );
}
