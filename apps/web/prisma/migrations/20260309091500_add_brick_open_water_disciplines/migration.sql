-- Add new discipline values to support end-to-end planning and scheduling.
ALTER TYPE "PlanSourceDiscipline" ADD VALUE IF NOT EXISTS 'SWIM_OPEN_WATER';
ALTER TYPE "PlanSourceDiscipline" ADD VALUE IF NOT EXISTS 'BRICK';
ALTER TYPE "WorkoutLibraryDiscipline" ADD VALUE IF NOT EXISTS 'SWIM_OPEN_WATER';

