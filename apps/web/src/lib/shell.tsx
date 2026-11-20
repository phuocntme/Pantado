"use client";
import { useRouter } from "next/navigation";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { useWallet, type ConnectMethod } from "./wallet";

/**
 * Which sign-in a Connect button means: "Continue with Google / X" and the email "Send code" go through Privy
 * when it is configured; wallet rows (and everything without Privy) connect the browser wallet.
 */
function connectMethod(btn: Element | null, sendCode: boolean, social: boolean): ConnectMethod | undefined {
  if (!social) return undefined;
  if (sendCode) {
    const email = (document.getElementById("email") as HTMLInputElement | null)?.value.trim();
    return { social: "email", email: email || undefined };
  }
  const label = btn?.textContent ?? "";
  if (/Continue with Google/.test(label)) return { social: "google" };
  if (/Continue with X/.test(label)) return { social: "twitter" };
  return undefined;
}

/**
 * Behaviour the reference wires globally: `[data-connect]` signs in and returns to the previous page,
 * `[data-logout]` signs out to Ask, internal links navigate client-side. Sets the document title.
 */
export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const w = useWallet();
  const router = useRouter();
  useEffect(() => {
    document.title = `${title} · Pantado`;
  }, [title]);
  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const el = e.target as HTMLElement;
    if (el.closest("[data-logout]")) {
      e.preventDefault();
      w.disconnect();
      router.push("/");
      return;
    }
    const c = el.closest("[data-connect]");
    const sendCode = w.socialEnabled && el.closest("button")?.textContent?.trim() === "Send code";
    if (c || sendCode) {
      e.preventDefault();
      void w
        .connect(connectMethod(c, sendCode, w.socialEnabled))
        .then(() => {
          const back = sessionStorage.getItem("pantado-back");
          router.push(back && back !== "/connect" ? back : "/");
        })
        .catch((err: unknown) => window.alert(err instanceof Error ? err.message : String(err)));
      return;
    }
    const a = el.closest("a[href]");
    const href = a?.getAttribute("href");
    if (href?.startsWith("/")) {
      e.preventDefault();
      if (href === "/connect") sessionStorage.setItem("pantado-back", window.location.pathname);
      router.push(href);
    }
  };
  return (
    <div id="app" onClick={onClick}>
      {children}
    </div>
  );
}
