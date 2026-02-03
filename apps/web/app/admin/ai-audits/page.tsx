import Link from 'next/link';
import type { UrlObject } from 'url';

import { requireAiPlanBuilderAuditAdminUserPage, normalizeAiAuditListQuery, listAiInvocationAuditsForAdmin } from '@/modules/ai-plan-builder/server/audit-admin';

export const dynamic = 'force-dynamic';

export default async function AdminAiAuditsPage(props: { searchParams?: Record<string, string | string[] | undefined> }) {
  const requester = await requireAiPlanBuilderAuditAdminUserPage();

  const query = normalizeAiAuditListQuery({ searchParams: props.searchParams ?? {} });
  const { items, page } = await listAiInvocationAuditsForAdmin({ query, requester });

  const prevOffset = Math.max(0, page.offset - page.limit);
  const nextOffset = page.offset + page.limit;

  const baseQuery: Record<string, string> = {
    range: query.range,
    limit: String(page.limit),
  };
  if (query.capability) baseQuery.capability = query.capability;
  if (query.fallbackUsed !== undefined) baseQuery.fallbackUsed = String(query.fallbackUsed);
  if (query.errorCode) baseQuery.errorCode = query.errorCode;
  if (query.actorType) baseQuery.actorType = query.actorType;

  const makeHref = (offset: number): UrlObject => {
    return {
      pathname: '/admin/ai-audits',
      query: {
        ...baseQuery,
        offset: String(offset),
      },
    };
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI Invocation Audits</h1>
        <div className="text-sm text-muted-foreground">Admin: {requester.email}</div>
      </div>

      <form method="get" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <label className="text-sm">
          Range
          <select name="range" defaultValue={query.range} className="mt-1 w-full rounded border px-2 py-1">
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
          </select>
        </label>

        <label className="text-sm">
          Capability
          <select name="capability" defaultValue={query.capability ?? ''} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">All</option>
            <option value="summarizeIntake">summarizeIntake</option>
            <option value="suggestDraftPlan">suggestDraftPlan</option>
            <option value="suggestProposalDiffs">suggestProposalDiffs</option>
            <option value="generateSessionDetail">generateSessionDetail</option>
            <option value="generateIntakeFromProfile">generateIntakeFromProfile</option>
          </select>
        </label>

        <label className="text-sm">
          Fallback
          <select
            name="fallbackUsed"
            defaultValue={query.fallbackUsed === undefined ? '' : String(query.fallbackUsed)}
            className="mt-1 w-full rounded border px-2 py-1"
          >
            <option value="">All</option>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>

        <label className="text-sm">
          Error
          <input
            name="errorCode"
            defaultValue={query.errorCode ?? ''}
            placeholder="e.g. LLM_RATE_LIMITED"
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>

        <label className="text-sm">
          Actor Type
          <select name="actorType" defaultValue={query.actorType ?? ''} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">All</option>
            <option value="COACH">COACH</option>
            <option value="ATHLETE">ATHLETE</option>
            <option value="SYSTEM">SYSTEM</option>
          </select>
        </label>

        <label className="text-sm">
          Limit
          <select name="limit" defaultValue={String(page.limit)} className="mt-1 w-full rounded border px-2 py-1">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>

        <input type="hidden" name="offset" value="0" />

        <div className="col-span-2 flex items-end gap-2 md:col-span-6">
          <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
            Apply
          </button>
          <Link href={{ pathname: '/admin/ai-audits' }} className="rounded border px-3 py-2 text-sm">
            Reset
          </Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              <th className="p-2">createdAt</th>
              <th className="p-2">capability</th>
              <th className="p-2">mode</th>
              <th className="p-2">provider/model</th>
              <th className="p-2">duration</th>
              <th className="p-2">retry</th>
              <th className="p-2">fallback</th>
              <th className="p-2">error</th>
              <th className="p-2">actor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2 whitespace-nowrap">
                  <Link className="underline" href={{ pathname: `/admin/ai-audits/${a.id}` }}>
                    {a.createdAt.toISOString()}
                  </Link>
                </td>
                <td className="p-2">{a.capability}</td>
                <td className="p-2">{a.effectiveMode}</td>
                <td className="p-2">{a.provider}{a.model ? `/${a.model}` : ''}</td>
                <td className="p-2">{a.durationMs}ms</td>
                <td className="p-2">{a.retryCount}</td>
                <td className="p-2">{a.fallbackUsed ? 'yes' : 'no'}</td>
                <td className="p-2">{a.errorCode ?? ''}</td>
                <td className="p-2">{a.actorType}:{a.actorIdDisplay}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="p-4 text-muted-foreground" colSpan={9}>
                  No results.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <div>
          Showing {page.offset + 1}–{page.offset + items.length} (limit {page.limit})
        </div>
        <div className="flex gap-2">
          {page.hasPrev ? (
            <Link className="rounded border px-3 py-1" href={makeHref(prevOffset)}>
              Prev
            </Link>
          ) : (
            <span className="rounded border px-3 py-1 text-muted-foreground">Prev</span>
          )}
          {page.hasNext ? (
            <Link className="rounded border px-3 py-1" href={makeHref(nextOffset)}>
              Next
            </Link>
          ) : (
            <span className="rounded border px-3 py-1 text-muted-foreground">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
