import { PrismaClient } from '@prisma/client';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function usage() {
  return `
Usage:
  node scripts/demo-linking.mjs list
  node scripts/demo-linking.mjs set-emails --coach-id <USER_ID> --athlete-id <USER_ID> \
    [--coach-email demo-coach@yourdomain.com] [--athlete-email demo-athlete@yourdomain.com]

Notes:
  - Requires DATABASE_URL in the environment.
  - This updates existing seeded User rows (no new data created).
`;
}

function assertEnv() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL in environment.');
    console.error('Example: DATABASE_URL="postgresql://user:pass@host:5432/db" node scripts/demo-linking.mjs list');
    process.exit(1);
  }
}

function printTable(rows, columns) {
  const widths = Object.fromEntries(
    columns.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))])
  );
  const header = columns.map((c) => c.padEnd(widths[c])).join('  ');
  console.log(header);
  console.log(columns.map((c) => '-'.repeat(widths[c])).join('  '));
  for (const row of rows) {
    console.log(columns.map((c) => String(row[c] ?? '').padEnd(widths[c])).join('  '));
  }
}

async function list(prisma) {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, authProviderId: true },
    orderBy: [{ role: 'asc' }, { id: 'asc' }],
  });

  console.log('\nUsers');
  printTable(users, ['id', 'email', 'role', 'authProviderId']);

  const athleteProfiles = await prisma.athleteProfile.findMany({
    select: { userId: true, coachId: true },
    orderBy: [{ coachId: 'asc' }, { userId: 'asc' }],
  });

  console.log('\nAthleteProfile');
  printTable(athleteProfiles, ['userId', 'coachId']);
}

async function setEmails(prisma, { coachId, athleteId, coachEmail, athleteEmail }) {
  if (!coachId || !athleteId) {
    console.error('Missing required flags: --coach-id and --athlete-id');
    console.error(usage());
    process.exit(1);
  }

  const coachEmailFinal = coachEmail || 'demo-coach@yourdomain.com';
  const athleteEmailFinal = athleteEmail || 'demo-athlete@yourdomain.com';

  await prisma.$transaction(async (tx) => {
    const coach = await tx.user.findUnique({
      where: { id: coachId },
      select: { id: true, role: true, email: true, authProviderId: true },
    });
    if (!coach) throw new Error(`Coach user not found: ${coachId}`);
    if (coach.role !== 'COACH') throw new Error(`Expected COACH role for ${coachId}, got ${coach.role}`);

    const athlete = await tx.user.findUnique({
      where: { id: athleteId },
      select: { id: true, role: true, email: true, authProviderId: true },
    });
    if (!athlete) throw new Error(`Athlete user not found: ${athleteId}`);
    if (athlete.role !== 'ATHLETE') throw new Error(`Expected ATHLETE role for ${athleteId}, got ${athlete.role}`);

    const conflicts = await tx.user.findMany({
      where: {
        email: { in: [coachEmailFinal, athleteEmailFinal] },
        NOT: { id: { in: [coachId, athleteId] } },
      },
      select: { id: true, email: true, role: true },
    });
    if (conflicts.length > 0) {
      const details = conflicts.map((u) => `${u.email} already used by ${u.id} (${u.role})`).join('; ');
      throw new Error(`Email conflict: ${details}`);
    }

    await tx.user.update({
      where: { id: coachId },
      data: { email: coachEmailFinal, authProviderId: null },
    });

    await tx.user.update({
      where: { id: athleteId },
      data: { email: athleteEmailFinal, authProviderId: null },
    });

    const ap = await tx.athleteProfile.findUnique({
      where: { userId: athleteId },
      select: { userId: true, coachId: true },
    });

    if (!ap) {
      console.warn(`Warning: No AthleteProfile found for athlete userId ${athleteId}`);
    } else if (ap.coachId !== coachId) {
      console.warn(
        `Warning: AthleteProfile.coachId (${ap.coachId}) does not match chosen coach user id (${coachId}).`
      );
    }
  });

  const updated = await prisma.user.findMany({
    where: { email: { in: [coachEmailFinal, athleteEmailFinal] } },
    select: { id: true, email: true, role: true, authProviderId: true },
    orderBy: [{ role: 'asc' }, { id: 'asc' }],
  });

  console.log('\nUpdated demo users');
  printTable(updated, ['id', 'email', 'role', 'authProviderId']);

  const apJoined = await prisma.athleteProfile.findUnique({
    where: { userId: updated.find((u) => u.email === athleteEmailFinal)?.id ?? '' },
    select: { userId: true, coachId: true },
  });

  if (apJoined) {
    console.log('\nAthleteProfile linkage');
    printTable([apJoined], ['userId', 'coachId']);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.help) {
    console.log(usage());
    return;
  }

  assertEnv();

  const prisma = new PrismaClient({
    log: args.debug ? ['query', 'error', 'warn'] : ['error', 'warn'],
  });

  try {
    if (cmd === 'list') {
      await list(prisma);
      return;
    }

    if (cmd === 'set-emails') {
      await setEmails(prisma, {
        coachId: args['coach-id'],
        athleteId: args['athlete-id'],
        coachEmail: args['coach-email'],
        athleteEmail: args['athlete-email'],
      });
      return;
    }

    console.error(`Unknown command: ${cmd}`);
    console.error(usage());
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
