import Create from "../../src/screens/create";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `/create`, `/create?draft=<base64url JSON>` (agent draft) or `/create?fork=<indexAddress>`. */
export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  return <Create draft={one(q.draft)} fork={one(q.fork)} />;
}
