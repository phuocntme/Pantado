import { Suspense } from "react";
import Chat from "../../src/screens/chat";

/** Ask conversation: `/ask?q=…&mode=auto|deep` starts one, `/ask?c=<id>` reopens one from the history. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Chat />
    </Suspense>
  );
}
