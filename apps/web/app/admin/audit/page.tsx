import Link from 'next/link';
import type { UrlObject } from 'url';

import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type AuditRow = {
  id: string;
  createdAt: Date;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  tableName: string;
  fieldName: string;
  recordId: string;
  changeText: string;
  beforeValue: unknown;
  afterValue: unknown;
  actorUserId: string | null;
  actorEmail: string | null;
};

type TableNameRow = { tableName: string };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function mapRangeToSince(range: string): Date {
  const now = Date.now();
  if (range === '24h') return new Date(now - 24 * 60 * 60 * 1000);
  if (range === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return new Date(now - 7 * 24 * 60 * 60 * 1000);
}

export default async function AdminAuditPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requester = await requireAdmin();
  const sp = props.searchParams ?? {};

  const range = first(sp.range) ?? '7d';
  const table = (first(sp.table) ?? '').trim();
  const user = (first(sp.user) ?? '').trim();
  const action = (first(sp.action) ?? '').trim().toUpperCase();
  const limit = clampInt(first(sp.limit), 100, 25, 500);
  const offset = clampInt(first(sp.offset), 0, 0, 100_000);
  const since = mapRangeToSince(range);

  const whereSql: string[] = [`"createdAt" >= $1`];
  const values: unknown[] = [since];

  if (table) {
    values.push(table);
    whereSql.push(`"tableName" = $${values.length}`);
  }
  if (user) {
    values.push(`%${user}%`);
    whereSql.push(`COALESCE("actorEmail", '') ILIKE $${values.length}`);
  }
  if (action === 'CREATE' || action === 'UPDATE' || action === 'DELETE') {
    values.push(action);
    whereSql.push(`"action" = CAST($${values.length} AS "AdminAuditAction")`);
  }

  values.push(limit);
  const limitPlaceholder = `$${values.length}`;
  values.push(offset);
  const offsetPlaceholder = `$${values.length}`;

  const whereClause = whereSql.length ? `WHERE ${whereSql.join(' AND ')}` : '';

  const events = (await prisma.$queryRawUnsafe(
    `SELECT
       "id",
       "createdAt",
       "action",
       "tableName",
       "fieldName",
       "recordId",
       "changeText",
       "beforeValue",
       "afterValue",
       "actorUserId",
       "actorEmail"
     FROM "AdminAuditEvent"
     ${whereClause}
     ORDER BY "createdAt" DESC
     LIMIT ${limitPlaceholder}
     OFFSET ${offsetPlaceholder}`,
    ...values
  )) as AuditRow[];

  const tableNames = (await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "tableName"
     FROM "AdminAuditEvent"
     ORDER BY "tableName" ASC
     LIMIT 200`
  )) as TableNameRow[];

  const hasPrev = offset > 0;
  const hasNext = events.length === limit;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  const baseQuery: Record<string, string> = {
    range,
    limit: String(limit),
  };
  if (table) baseQuery.table = table;
  if (user) baseQuery.user = user;
  if (action) baseQuery.action = action;

  const makeHref = (next: number): UrlObject => ({
    pathname: '/admin/audit',
    query: {
      ...baseQuery,
      offset: String(next),
    },
  });

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Data Audit Log</h1>
        <div className="text-sm text-muted-foreground">Admin: {requester.user.email}</div>
      </div>

      <form method="get" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <label className="text-sm">
          Range
          <select name="range" defaultValue={range} className="mt-1 w-full rounded border px-2 py-1">
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
          </select>
        </label>

        <label className="text-sm">
          Table
          <select name="table" defaultValue={table} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">All</option>
            {tableNames.map((row) => (
              <option key={row.tableName} value={row.tableName}>
                {row.tableName}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          User (email)
          <input name="user" defaultValue={user} placeholder="Search user email" className="mt-1 w-full rounded border px-2 py-1" />
        </label>

        <label className="text-sm">
          Action
          <select name="action" defaultValue={action} className="mt-1 w-full rounded border px-2 py-1">
            <option value="">All</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </label>

        <label className="text-sm">
          Limit
          <select name="limit" defaultValue={String(limit)} className="mt-1 w-full rounded border px-2 py-1">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="500">500</option>
          </select>
        </label>

        <input type="hidden" name="offset" value="0" />

        <div className="col-span-2 flex items-end gap-2 md:col-span-6">
          <button type="submit" className="rounded bg-black px-3 py-2 text-sm text-white">
            Apply
          </button>
          <Link href={{ pathname: '/admin/audit' }} className="rounded border px-3 py-2 text-sm">
            Reset
          </Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr className="text-left">
              <th className="p-2">Date/Time</th>
              <th className="p-2">User</th>
              <th className="p-2">Data table</th>
              <th className="p-2">Field</th>
              <th className="p-2">Record</th>
              <th className="p-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={6}>
                  No audit events found for this filter.
                </td>
              </tr>
            ) : (
              events.map((event) => {
                const userLabel = event.actorEmail ?? event.actorUserId ?? 'System';
                const beforeText = event.beforeValue == null ? '' : ` | before=${JSON.stringify(event.beforeValue)}`;
                const afterText = event.afterValue == null ? '' : ` | after=${JSON.stringify(event.afterValue)}`;
                return (
                  <tr key={event.id} className="border-t align-top">
                    <td className="p-2 whitespace-nowrap">{new Date(event.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</td>
                    <td className="p-2">{userLabel}</td>
                    <td className="p-2">{event.tableName}</td>
                    <td className="p-2">{event.fieldName}</td>
                    <td className="p-2 font-mono text-xs">{event.recordId}</td>
                    <td className="p-2">
                      {event.action}: {event.changeText}
                      {beforeText}
                      {afterText}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Link
          href={makeHref(prevOffset)}
          className={`rounded border px-3 py-2 text-sm ${hasPrev ? '' : 'pointer-events-none opacity-50'}`}
        >
          Previous
        </Link>
        <Link
          href={makeHref(nextOffset)}
          className={`rounded border px-3 py-2 text-sm ${hasNext ? '' : 'pointer-events-none opacity-50'}`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
