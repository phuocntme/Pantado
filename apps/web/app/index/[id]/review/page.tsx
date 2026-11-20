import ReviewPurchase from "../../../../src/screens/review";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ amount?: string }> }) {
  const { id } = await params;
  const { amount } = await searchParams;
  return <ReviewPurchase index={id} amount={amount ?? "1000"} />;
}
