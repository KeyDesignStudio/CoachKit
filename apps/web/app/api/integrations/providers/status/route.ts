import { DEVICE_PROVIDERS, getProviderOAuthConfig, providerSlug, toExternalProvider } from '@/lib/integrations/providers';
import { requireAthlete } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

type ProviderStatus = {
  provider: string;
  slug: string;
  configured: boolean;
  connected: boolean;
  connection: {
    externalAthleteId: string;
    expiresAt: string | null;
    scope: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export async function GET() {
  try {
    const { user } = await requireAthlete();

    const rows = await Promise.all(
      DEVICE_PROVIDERS.map(async (provider): Promise<ProviderStatus> => {
        const cfg = getProviderOAuthConfig(provider, 'http://localhost');
        const connection = await prisma.externalConnection.findUnique({
          where: {
            athleteId_provider: {
              athleteId: user.id,
              provider: toExternalProvider(provider),
            },
          },
          select: {
            externalAthleteId: true,
            expiresAt: true,
            scope: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return {
          provider,
          slug: providerSlug(provider),
          configured: Boolean(cfg.clientId && cfg.authorizeUrl),
          connected: Boolean(connection),
          connection: connection
            ? {
                externalAthleteId: connection.externalAthleteId,
                expiresAt: connection.expiresAt ? connection.expiresAt.toISOString() : null,
                scope: connection.scope,
                createdAt: connection.createdAt.toISOString(),
                updatedAt: connection.updatedAt.toISOString(),
              }
            : null,
        };
      })
    );

    return success({ providers: rows });
  } catch (error) {
    return handleError(error);
  }
}
