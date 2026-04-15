-- Many-to-many join tables that let a User be tagged with the Positions they
-- are trained for and the Locations they work at. The scheduling page uses
-- these to filter the employee roster by job position / location.
--
-- Prisma implicit-relation convention: table name = "_<RelationName>",
-- columns A (first model alphabetically) and B (second), with unique (A,B)
-- and a secondary index on B.

-- User <-> Position (relation "UserPositions"): Position < User alphabetically,
-- so A = Position.id, B = User.id.
CREATE TABLE "_UserPositions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_UserPositions_AB_unique" ON "_UserPositions"("A", "B");
CREATE INDEX "_UserPositions_B_index" ON "_UserPositions"("B");

ALTER TABLE "_UserPositions"
    ADD CONSTRAINT "_UserPositions_A_fkey"
    FOREIGN KEY ("A") REFERENCES "positions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_UserPositions"
    ADD CONSTRAINT "_UserPositions_B_fkey"
    FOREIGN KEY ("B") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- User <-> Location (relation "UserLocations"): Location < User alphabetically,
-- so A = Location.id, B = User.id.
CREATE TABLE "_UserLocations" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_UserLocations_AB_unique" ON "_UserLocations"("A", "B");
CREATE INDEX "_UserLocations_B_index" ON "_UserLocations"("B");

ALTER TABLE "_UserLocations"
    ADD CONSTRAINT "_UserLocations_A_fkey"
    FOREIGN KEY ("A") REFERENCES "locations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_UserLocations"
    ADD CONSTRAINT "_UserLocations_B_fkey"
    FOREIGN KEY ("B") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
