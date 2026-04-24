export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  employmentType?: EmploymentType;
  organizationId?: string;
  weeklyHoursCap?: number | null;
  pin?: string | null;
  icalToken?: string | null;
  birthDate?: string | null;
  isMinor?: boolean;
  isActive?: boolean;
  // True when this manager has full authority at every location in
  // managedLocations (store-manager). False means their authority is
  // scoped to managedDepartments instead.
  isStoreManager?: boolean;
  positions?: Pick<Position, 'id' | 'name' | 'color'>[];
  locations?: Pick<Location, 'id' | 'name'>[];
  // Scope payload — populated by /auth/me for the logged-in user, and by
  // the team-list endpoint for every member the viewer can see. Used by
  // the Team page to decide which rows a MANAGER can act on and by the
  // Employee Edit modal to render the current scope assignments.
  managedLocations?: Pick<Location, 'id' | 'name'>[];
  managedDepartments?: Department[];
}

export interface Shift {
  id: string;
  startTime: string;
  endTime: string;
  notes?: string;
  status: 'DRAFT' | 'PUBLISHED';
  confirmedAt?: string | null;
  user?: Pick<User, 'id' | 'firstName' | 'lastName'>;
  position?: Position;
  location?: Location;
}

export interface Position {
  id: string;
  name: string;
  color: string;
  hourlyRate?: number;
}

export interface Location {
  id: string;
  name: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number;
  weeklyBudget?: number | null;
}

// A named grouping of Positions at one Location. The unit managers are
// scoped to via managedDepartments. Keep the shape in sync with what
// /api/departments returns (include: { location, positions, managers }).
export interface Department {
  id: string;
  name: string;
  locationId: string;
  organizationId?: string;
  location?: Pick<Location, 'id' | 'name'>;
  positions?: Pick<Position, 'id' | 'name' | 'color'>[];
  managers?: Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'role' | 'isActive'>[];
}

export interface AuthResponse {
  token: string;
  user: User;
}
