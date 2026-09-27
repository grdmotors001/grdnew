'use client';
import ChatPage from '../app/chat/page';

// Facebook-Messenger style floating chat/call popup for desktop: a round
// bubble pinned to the bottom-right corner that opens the existing Office
// Chat UI in a small panel over the current page, instead of navigating
// away to the full /chat route. `open`/`onOpenChange` are controlled by
// the parent (Shell.jsx, DealerPortal.jsx) so a header icon can toggle the
// same popup the bubble does. Hidden on small screens via chat.css — on
// mobile the header/nav "Office Chat" buttons should keep navigating to
// the full /chat page instead of using this component.
export function ChatWidget({ open, onOpenChange }) {
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
