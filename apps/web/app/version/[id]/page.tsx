import VersionPage from "../../../src/screens/version";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VersionPage id={id} />;
}
