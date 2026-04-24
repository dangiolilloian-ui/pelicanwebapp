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
  positions?: Pick<Position, 'id' | 'name' | 'color'>[];
  locations?: Pick<Location, 'id' | 'name'>[];
  // Only populated on the /auth/me payload for the logged-in user — used by
  // the Team page to decide which rows a MANAGER can act on.
  managedLocations?: Pick<Location, 'id' | 'name'>[];
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

export interface AuthResponse {
  token: string;
  user: User;
}
