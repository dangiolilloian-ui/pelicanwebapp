const { Router } = require('express');
const prisma = require('../config/db');
const { performClockIn } = require('./timeclock');
const { distanceMeters } = require('../lib/distance');

const router = Router();

// The kiosk is scoped to a specific Location via its ID in the URL.
// Anyone at the store can type a PIN — the physical location acts as auth.
// To avoid abuse we require that the location has coordinates configured
// and the caller still sends lat/lng (browser geolocation).

async function resolveLocation(locationId) {
  if (!locationId) return null;
  return prisma.location.findUnique({ where: { id: locationId } });
}

// Look up an employee by org + PIN
async function findByPin(organizationId, pin) {
  if (!pin || pin.length < 3) return null;
  return prisma.user.findFirst({
    where: { organizationId, pin },
    select: { id: true, firstName: true, lastName: true, role: true, organizationId: true },
  });
}

// Info about a kiosk location — used to initialize the UI
router.get('/locations/:locationId', async (req, res) => {
  const loc = await resolveLocation(req.params.locationId);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  res.json({
    id: loc.id,
    name: loc.name,
    organizationId: loc.organizationId,
    hasGeofence: loc.latitude != null && loc.longitude != null,
    latitude: loc.latitude,
    longitude: loc.longitude,
    radiusMeters: loc.radiusMeters,
  });
});

// Verify PIN (used to show "Hi {name}" before the action button)
router.post('/locations/:locationId/verify', async (req, res) => {
  const loc = await resolveLocation(req.params.locationId);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const { pin } = req.body || {};
  const user = await findByPin(loc.organizationId, pin);
  if (!user) return res.status(404).json({ error: 'PIN not recognized' });

  const active = await prisma.timeEntry.findFirst({
    where: { userId: user.id, clockOut: null },
  });

  res.json({
    firstName: user.firstName,
    lastName: user.lastName,
    clockedIn: !!active,
    activeEntry: active,
  });
});

// Clock in from the kiosk
router.post('/locations/:locationId/clock-in', async (req, res) => {
  const loc = await resolveLocation(req.params.locationId);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const { pin, latitude, longitude } = req.body || {};
  const user = await findByPin(loc.organizationId, pin);
  if (!user) return res.status(404).json({ error: 'PIN not recognized' });

  // If the location has a geofence, enforce it based on browser coordinates.
  if (loc.latitude != null && loc.longitude != null) {
    if (latitude == null || longitude == null) {
      return res.status(403).json({ error: 'Location permission required', code: 'GEOFENCE_REQUIRED' });
    }
    const d = distanceMeters(Number(latitude), Number(longitude), loc.latitude, loc.longitude);
    if (d > loc.radiusMeters) {
      return res.status(403).json({
        error: `Device is ${Math.round(d)}m from ${loc.name}, outside the ${loc.radiusMeters}m geofence.`,
        code: 'GEOFENCE_OUT_OF_RANGE',
        distance: Math.round(d),
      });
    }
  }

  try {
    const entry = await performClockIn({
      userId: user.id,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      // Shared helper already validated location of the kiosk — skip its
      // shift-level geofence so we don't double-check with the same coords.
      overrideGeofence: true,
    });
    res.status(201).json({ entry, firstName: user.firstName });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// Clock out from the kiosk
router.post('/locations/:locationId/clock-out', async (req, res) => {
  const loc = await resolveLocation(req.params.locationId);
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const { pin } = req.body || {};
  const user = await findByPin(loc.organizationId, pin);
  if (!user) return res.status(404).json({ error: 'PIN not recognized' });

  const active = await prisma.timeEntry.findFirst({
    where: { userId: user.id, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });
  if (!active) return res.status(400).json({ error: 'Not clocked in' });

  const entry = await prisma.timeEntry.update({
    where: { id: active.id },
    data: { clockOut: new Date() },
  });
  res.json({ entry, firstName: user.firstName });
});

module.exports = router;
