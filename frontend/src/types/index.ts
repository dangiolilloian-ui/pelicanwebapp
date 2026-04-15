export type Role = 'OWNER' | 'MANAGER' | 'EMPLOYEE';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  organizationId?: string;
  weeklyHoursCap?: number | null;
  pin?: string | null;
  icalToken?: string | null;
  birthDate?: string | null;
  positions?: Pick<Position, 'id' | 'name' | 'color'>[];
  locations?: Pick<Location, 'id' | 'name'>[];
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
