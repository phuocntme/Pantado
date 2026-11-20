import type { Binding } from "../bindings.js";

/**
 * Connect: the dialog's `data-connect` buttons sign in through the shell; the Ask home behind it is live. The
 * sign-in marks (color swatches in the reference) are slots drawing each brand's logo at the swatch's size.
 */
export const binding: Binding = {
  slots: [
    // the sidebar's "Swap any asset" / "Buy an index" shortcuts are not shown: an empty slot
    { tag: "div", attrs: { style: "margin-top: auto; display: flex; flex-direction: column; gap: 8px" }, name: "sideShortcuts" },
    // the sidebar's saved chats (reference: empty state only) and its search box (chat.history.tsx)
    { tag: "input", attrs: { id: "chat-search" }, name: "chatSearch" },
    { tag: "div", attrs: { "style~": "padding: 56px 12px" }, name: "chatHistory" },
    { tag: "span", attrs: { "style~": "conic-gradient(#EA4335" }, name: "googleMark" },
    { tag: "span", attrs: { style: "font-weight: 700", "aria-hidden": "true" }, name: "xMark" },
    { tag: "span", attrs: { "style~": "border-radius: 8px; background: #9052F9" }, name: "coreMark" },
    { tag: "span", attrs: { "style~": "border-radius: 8px; background: #F6851B" }, name: "metamaskMark" },
    { tag: "span", attrs: { "style~": "border-radius: 8px; background: #3B99FC" }, name: "walletconnectMark" },
  ],
};
