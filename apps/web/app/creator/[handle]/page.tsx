import Creator from "../../../src/screens/creator";

/** Public creator page. Handles are wallet addresses until profiles exist (API `/creators/:handle`). */
export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <Creator address={decodeURIComponent(handle)} />;
}
