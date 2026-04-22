-- Department managers: many-to-many between users and positions/locations
-- Prisma implicit m2m tables follow the naming convention _RelationName

CREATE TABLE "_PositionManagers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PositionManagers_A_fkey" FOREIGN KEY ("A") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PositionManagers_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_PositionManagers_AB_unique" ON "_PositionManagers"("A", "B");
CREATE INDEX "_PositionManagers_B_index" ON "_PositionManagers"("B");

CREATE TABLE "_LocationManagers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_LocationManagers_A_fkey" FOREIGN KEY ("A") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_LocationManagers_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "_LocationManagers_AB_unique" ON "_LocationManagers"("A", "B");
CREATE INDEX "_LocationManagers_B_index" ON "_LocationManagers"("B");
