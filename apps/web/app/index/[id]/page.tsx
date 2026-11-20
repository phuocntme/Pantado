import IndexPage from "../../../src/screens/index";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IndexPage id={id} />;
}
