import Asset from "../../../src/screens/asset";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Asset id={decodeURIComponent(id).toLowerCase()} />;
}
