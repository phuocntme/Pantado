import type { Binding } from "../bindings.js";

/**
 * Ask home: suggestion rows, tabs and modes are already view-model driven in the reference. The ask box becomes a
 * controlled input (Enter sends); the Send link carries the typed question through `_href.AskChat`.
 */
export const binding: Binding = {
  slots: [
    // the sidebar's "Swap any asset" / "Buy an index" shortcuts are not shown: an empty slot
    { tag: "div", attrs: { style: "margin-top: auto; display: flex; flex-direction: column; gap: 8px" }, name: "sideShortcuts" },
    { tag: "textarea", attrs: { id: "ask-input" }, name: "askInput" },
    // the sidebar's saved chats (reference: empty state only) and its search box (chat.history.tsx)
    { tag: "input", attrs: { id: "chat-search" }, name: "chatSearch" },
    { tag: "div", attrs: { "style~": "padding: 56px 12px" }, name: "chatHistory" },
  ],
};
