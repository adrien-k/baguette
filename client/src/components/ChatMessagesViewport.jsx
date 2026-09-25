/** Centered content width (padding), matching Dashboard `max-w-5xl mx-auto px-4`. */
export const CHAT_COLUMN_CLASS = 'w-full max-w-5xl mx-auto px-4';

/**
 * Scrollable message list with optional bottom fade above the composer (session + review chat).
 */
export default function ChatMessagesViewport({
  children,
  showBottomFade = false,
  scrollRef,
  className = '',
}) {
  return (
    <div className={`relative flex-1 min-h-0 min-w-0 ${className}`}>
      <div ref={scrollRef} className="absolute inset-0 overflow-auto pb-14">
        <div className={`${CHAT_COLUMN_CLASS} py-3 sm:py-4 space-y-3`}>{children}</div>
      </div>
      {showBottomFade && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-950 to-transparent z-[1]"
          aria-hidden
        />
      )}
    </div>
  );
}
