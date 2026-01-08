import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/errors';

export type TemplateSummary = {
  id: string;
  title: string;
  discipline: string;
  subtype: string | null;
};

export async function findCoachTemplate(templateId: string, coachId: string): Promise<TemplateSummary> {
  const template = await prisma.workoutTemplate.findFirst({
    where: { id: templateId, coachId },
    select: { id: true, title: true, discipline: true, subtype: true },
  });

  if (!template) {
    throw notFound('Template not found for this coach.');
  }

  return template;
}
