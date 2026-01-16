-- AlterTable
ALTER TABLE "CalendarItem" ADD COLUMN     "distanceMeters" DOUBLE PRECISION,
ADD COLUMN     "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "intensityTarget" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "workoutStructure" JSONB;

-- AlterTable
ALTER TABLE "GroupSession" ADD COLUMN     "distanceMeters" DOUBLE PRECISION,
ADD COLUMN     "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "intensityTarget" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "workoutStructure" JSONB;
