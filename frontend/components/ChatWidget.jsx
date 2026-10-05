'use client';
import { useEffect } from 'react';
import ChatPage from '../app/chat/page';
import { getToken } from '../lib/api';

// Presence heartbeat: jab tak staff/dealer logged in hai aur tab khula hai,
// har 60 sec me server ko ping jata hai. Admin chat ke "Online" tab me dekhta hai.
function usePresenceHeartbeat() {
  useEffect(() => {
    let stop = false;
    const ping = () => {
      const t = getToken();
      if (stop || !t || document.visibilityState === 'hidden') return;
      fetch('/api/backend/presence', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 60000);
    const vis = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
}

// Facebook-Messenger style floating chat/call popup for desktop: a round
// bubble pinned to the bottom-right corner that opens the existing Office
// Chat UI in a small panel over the current page, instead of navigating
// away to the full /chat route. `open`/`onOpenChange` are controlled by
// the parent (Shell.jsx, DealerPortal.jsx) so a header icon can toggle the
// same popup the bubble does. Hidden on small screens via chat.css — on
// mobile the header/nav "Office Chat" buttons should keep navigating to
// the full /chat page instead of using this component.
export function ChatWidget({ open, onOpenChange }) {
  usePresenceHeartbeat();
  return (
    <>
      <button
        type="button"
        className="chatWidgetToggle"
        onClick={() => onOpenChange(!open)}
        title="Office Chat"
        aria-label="Office Chat"
      >
        {open ? '✕' : '💬'}
      </button>
      {open && (
        <div className="chatWidgetPanel">
          <ChatPage onClose={() => onOpenChange(false)} />
        </div>
      )}
    </>
  );
}
