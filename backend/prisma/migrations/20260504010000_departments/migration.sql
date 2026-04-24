-- Introduce Departments: a named grouping of Positions at one Location.
-- Replaces the orthogonal (managedPositions x managedLocations) intersection
-- model with:
--   * Department = explicit grouping (unique by location + name).
--   * User.is_store_manager = true means this manager has full authority at
--     every location in managedLocations. Set false for dept-scoped managers.
--   * _DepartmentManagers = which managers oversee which departments.
--   * _DepartmentPositions = which positions belong to which departments.
--
-- Data migration: anyone who was in _LocationManagers becomes a store manager
-- at those locations (full-store authority is the safest back-compat behavior
-- -- they already had it). _PositionManagers is dropped because position-only
-- authority now lives inside Departments; any existing rows are discarded
-- since we have no way to synthesize a Department from a bare position.

-- 1. is_store_manager flag on users
ALTER TABLE "users"
  ADD COLUMN "is_store_manager" BOOLEAN NOT NULL DEFAULT false;

-- 2. departments table
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_location_id_name_key" ON "departments"("location_id", "name");
CREATE INDEX "departments_organization_id_idx" ON "departments"("organization_id");

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. _DepartmentPositions (Department <-> Position, implicit M:N)
CREATE TABLE "_DepartmentPositions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_DepartmentPositions_A_fkey" FOREIGN KEY ("A") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_DepartmentPositions_B_fkey" FOREIGN KEY ("B") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_DepartmentPositions_AB_unique" ON "_DepartmentPositions"("A", "B");
CREATE INDEX "_DepartmentPositions_B_index" ON "_DepartmentPositions"("B");

-- 4. _DepartmentManagers (Department <-> User, implicit M:N)
CREATE TABLE "_DepartmentManagers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_DepartmentManagers_A_fkey" FOREIGN KEY ("A") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_DepartmentManagers_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_DepartmentManagers_AB_unique" ON "_DepartmentManagers"("A", "B");
CREATE INDEX "_DepartmentManagers_B_index" ON "_DepartmentManagers"("B");

-- 5. Data migration: existing location-managers become store-managers so
-- their day-one behavior is identical to before the refactor.
UPDATE "users"
  SET "is_store_manager" = true
  WHERE "id" IN (SELECT DISTINCT "B" FROM "_LocationManagers");

-- 6. Drop _PositionManagers -- position-only authority is gone. Any rows here
-- would require human input to be remapped into Departments, so we drop.
DROP TABLE IF EXISTS "_PositionManagers";
