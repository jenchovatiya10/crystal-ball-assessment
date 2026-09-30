import { AssistantPanel } from "@/components/AssistantPanel";
import { fetchApprovals } from "@/lib/fetch-approvals";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const approvals = await fetchApprovals();

  return (
    <main className="page-shell">
      <AssistantPanel approvals={approvals} />
    </main>
  );
}
