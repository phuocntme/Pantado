import type { Binding } from "../bindings.js";

/**
 * Ask conversation. The reference conversation is five canned answers; live, the answer streams from the agent
 * (PORTING.md › Agent), so the conversation column and the three card asides are slots rendered with the
 * reference markup and styles from live data (src/screens/chat.tsx). The chat list is view-model driven; each row
 * is a slot so it can carry a delete control next to the reference button.
 */
export const binding: Binding = {
  slots: [
    // the sidebar's "Swap any asset" / "Buy an index" shortcuts are not shown: an empty slot
    { tag: "div", attrs: { style: "margin-top: auto; display: flex; flex-direction: column; gap: 8px" }, name: "sideShortcuts" },
    { tag: "input", attrs: { id: "chat-search" }, name: "chatSearch" },
    // list head: "Today" over saved chats, else the empty state (no wallet: "Connect to see your chats")
    { tag: "span", attrs: { style: "padding: 6px 12px; font-size: 12px; color: #8E8E96" }, text: "Today", name: "listHead" },
    // one history row: the reference button plus a delete control (chat.parts.tsx ConvRow)
    { tag: "button", attrs: { "aria-pressed": "{{cv.on}}" }, name: "convRow" },
    { tag: "section", attrs: { "aria-label": "Conversation" }, name: "conversation" },
    { tag: "aside", attrs: { "aria-label": "NVDA" }, name: "assetCard" },
    { tag: "aside", attrs: { "aria-label": "Selected basket" }, name: "draftCard" },
    { tag: "aside", attrs: { "aria-label": "Avalanche Blue Chips" }, name: "indexCard" },
  ],
};
