// Toast host — surfaces failed commands. Before this, every `catch` wrote
// `appStore.error` and nothing rendered it, so a failed stop / remove / prune
// was completely silent.

import { useEffect } from 'react';
import { Glyph } from './Icon';
import { useAppStore } from '@/store/appStore';

const DISMISS_MS = 6000;

function Toast({ id, text }: { id: number; text: string }) {
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    const t = window.setTimeout(() => dismiss(id), DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [id, dismiss]);

  return (
    <div className="toast" role="status">
      <span className="toast-icon">
        <Glyph name="close" size={12} sw={2} />
      </span>
      <span className="toast-text mono">{text}</span>
      <button
        type="button"
        className="toast-x"
        aria-label="Dismiss"
        onClick={() => dismiss(id)}
      >
        <Glyph name="close" size={11} sw={2} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} text={t.text} />
      ))}
    </div>
  );
}
