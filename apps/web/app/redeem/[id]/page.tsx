import RedeemPage from "../../../src/screens/redeem";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ units?: string }> }) {
  const { id } = await params;
  const { units } = await searchParams;
  return <RedeemPage id={id} units={units ?? null} />;
}
