import { opsFetch } from '@/lib/ops-fetch';
import { ErrorCallout } from '@/components/ErrorCallout';
import { ChatWindow } from '@/components/ChatWindow';

interface Message {
  id: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_bot_message: boolean;
}

interface MessagesResponse {
  messages: Message[];
  group_jid: string | null;
}

export default async function ChatPage() {
  let data: MessagesResponse;
  try {
    data = await opsFetch<MessagesResponse>('/ops/messages', { limit: '100' });
  } catch (err) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Chat</h2>
        <ErrorCallout
          message={err instanceof Error ? err.message : 'Failed to load messages'}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xl font-bold">Chat</h2>
      {!data.group_jid && (
        <div className="text-sm text-zinc-500">
          No main group registered. Send a message via WhatsApp first.
        </div>
      )}
      <ChatWindow initialMessages={data.messages} />
    </div>
  );
}
