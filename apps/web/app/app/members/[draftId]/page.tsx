"use client";

import { useRouter } from "next/navigation";
import { use } from "react";
import { FlowHeader } from "@/components/app/shell/FlowHeader";
import { MembersEditor } from "@/components/app/members/MembersEditor";
import { ForwardCTA } from "@/components/app/common/ForwardCTA";
import { PageHeader, Panel } from "@/components/app/common/Primitives";
import { DraftState, DraftSummary } from "@/components/app/common/DraftSummary";
import { useDraft } from "@/components/app/common/useDraft";
import { ORGANISER_MEMBER_KEY } from "@/components/app/split/draft-input";

interface Props {
  params: Promise<{ draftId: string }>;
}

export default function MembersPage({ params }: Props) {
  const { draftId } = use(params);
  return <MembersContent key={draftId} draftId={draftId} />;
}

function MembersContent({ draftId }: { draftId: string }) {
  const router = useRouter();
  const { draft, setDraft, loading, loadError, reload, saving, saveError, saved, save } = useDraft(draftId);
  const includeOrganiser = draft?.includeOrganiser === true;

  const handleMembersChange = (next: string[]) => {
    if (!draft) return;
    setDraft({
      ...draft,
      members: next,
      amounts: next.map((name) => draft.amounts[draft.members.indexOf(name)] ?? ""),
      assignments: Object.fromEntries(Object.entries(draft.assignments ?? {}).map(([item, names]) => [
        item, names.filter((name) => next.includes(name) || (includeOrganiser && name === ORGANISER_MEMBER_KEY)),
      ])),
    });
  };

  const handleContinue = async () => {
    if (!draft || saving) return;
    const totalPeople = draft.members.length + (includeOrganiser ? 1 : 0);
    if (totalPeople === 0) return;
    if (await save()) router.push(`/app/split/${draftId}`);
  };

  if (!draft)
    return (
      <>
        <FlowHeader step="members" />
        <DraftState loading={loading} error={loadError} onRetry={reload} />
      </>
    );

  const totalPeople = draft.members.length + (includeOrganiser ? 1 : 0);

  return (
    <div className="flex flex-1 flex-col">
      <FlowHeader
        step="members"
        busy={saving}
        onBack={async () => {
          if (await save()) router.push(`/app/review/${draftId}`);
        }}
      />
      <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
        <PageHeader
          eyebrow="Add participants"
          title={
            <>
              Choose who will <span className="font-serif italic">share this bill.</span>
            </>
          }
          description="Enter each person's name or nickname. Each participant receives an independently encrypted payment link with the content key in the fragment."
        />
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
          <Panel>
            <fieldset disabled={saving} className="min-w-0">
              <legend className="sr-only">People in this split</legend>
              <MembersEditor
                members={draft.members}
                includeOrganiser={includeOrganiser}
                onMembersChange={handleMembersChange}
                onIncludeOrganiserChange={(include) => setDraft({
                  ...draft,
                  includeOrganiser: include,
                  assignments: Object.fromEntries(Object.entries(draft.assignments ?? {}).map(([item, names]) => [
                    item, names.filter((name) => include || name !== ORGANISER_MEMBER_KEY),
                  ])),
                })}
              />
            </fieldset>
          </Panel>
          <aside className="min-w-0">
            <DraftSummary draft={draft} saved={saved} saving={saving} error={saveError} onRetry={() => { void save(); }}>
              <ForwardCTA
                label="Choose how to split"
                onClick={handleContinue}
                disabled={totalPeople === 0}
                busy={saving}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {totalPeople === 0
                  ? "Add at least one person before choosing how to divide the bill."
                  : "You can assign equal shares, custom amounts, or specific items on the next step."}
              </p>
            </DraftSummary>
          </aside>
        </div>
      </div>
    </div>
  );
}
