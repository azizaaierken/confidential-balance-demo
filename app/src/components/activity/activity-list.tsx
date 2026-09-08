import { ActivityEntry, Role } from "@/lib/types";
import { ActivityRow } from "./activity-row";

export function ActivityList({
  entries,
  role,
  ownerAccountId,
  emptyLabel = "No activity yet.",
}: {
  entries: ActivityEntry[];
  role: Role;
  ownerAccountId: string;
  emptyLabel?: string;
}) {
  if (entries.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-ink-500">{emptyLabel}</p>;
  }
  return (
    <div>
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} role={role} ownerAccountId={ownerAccountId} />
      ))}
    </div>
  );
}
