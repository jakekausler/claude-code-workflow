import { useState, useCallback, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useSendMessage } from '../../api/interaction-hooks.js';

export interface MessageInputProps {
  stageId: string;
  disabled?: boolean;
  queuedMessage?: string;
}

export function MessageInput({ stageId, disabled, queuedMessage }: MessageInputProps) {
  const [text, setText] = useState('');
  const sendMutation = useSendMessage(stageId);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    sendMutation.mutate(trimmed);
    setText('');
  }, [text, disabled, sendMutation]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-zinc-700 bg-zinc-900 p-3">
      {queuedMessage && (
        <div className="mb-2 rounded bg-yellow-900/30 px-3 py-1.5 text-xs text-yellow-300">
          Message queued: &quot;{queuedMessage}&quot;
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'No active session' : 'Send a follow-up message...'}
          disabled={disabled}
          rows={1}
          aria-label="Send a message to Claude"
          className="flex-1 resize-none rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim() || sendMutation.isPending}
          className="rounded bg-blue-600 p-2 text-white hover:bg-blue-500 disabled:opacity-50"
          title="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
