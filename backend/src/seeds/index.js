const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning database...');
  await prisma.message.deleteMany();
  await prisma.timeOffRequest.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.user.deleteMany();
  await prisma.position.deleteMany();
  await prisma.location.deleteMany();
  await prisma.organization.deleteMany();

  console.log('Creating organization...');
  const org = await prisma.organization.create({
    data: { name: 'Pelican Shops', timezone: 'America/New_York' },
  });

  const hash = await bcrypt.hash('pelican2024', 10);

  // Locations
  console.log('Creating locations...');
  const locations = await Promise.all([
    prisma.location.create({ data: { name: 'Whitehouse, NJ', address: '4 US-22, Whitehouse Station, NJ 08889', organizationId: org.id } }),
    prisma.location.create({ data: { name: 'Morris Plains, NJ', address: '2599 Route 10, Morris Plains, NJ 07950', organizationId: org.id } }),
    prisma.location.create({ data: { name: 'East Brunswick, NJ', address: '299 NJ-18, East Brunswick, NJ 08816', organizationId: org.id } }),
    prisma.location.create({ data: { name: 'Quakertown, PA', address: '301 S West End Blvd, Quakertown, PA 18951', organizationId: org.id } }),
  ]);
  const [whitehouse, morrisPlains, eastBrunswick, quakertown] = locations;

  // Positions
  console.log('Creating positions...');
  const positions = await Promise.all([
    prisma.position.create({ data: { name: 'Store Manager', color: '#7c3aed', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Asst. Manager', color: '#8b5cf6', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Sales - Spas & Hot Tubs', color: '#2563eb', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Sales - Pools', color: '#0891b2', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Sales - Patio & Outdoor', color: '#059669', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Sales - Winter Sports', color: '#0284c7', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Sales - General', color: '#6366f1', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Service Technician', color: '#dc2626', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Installation Crew', color: '#ea580c', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Ski/Board Rental', color: '#0ea5e9', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Boot Fitter', color: '#6d28d9', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Warehouse', color: '#78716c', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Cashier', color: '#16a34a', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Customer Service', color: '#ca8a04', organizationId: org.id } }),
    prisma.position.create({ data: { name: 'Delivery Driver', color: '#9333ea', organizationId: org.id } }),
  ]);

  const posMap = {};
  positions.forEach((p) => { posMap[p.name] = p.id; });

  // Employees
  console.log('Creating 90 employees...');
  const employees = [
    // Owner
    { firstName: 'Agustin', lastName: 'Pelican', email: 'agustin@pelicanshops.com', role: 'OWNER', phone: '+1 908-555-0001' },
    // Store Managers (4)
    { firstName: 'Michael', lastName: 'Brennan', email: 'mbrennan@pelicanshops.com', role: 'MANAGER', phone: '+1 908-555-0010' },
    { firstName: 'Sarah', lastName: 'Chen', email: 'schen@pelicanshops.com', role: 'MANAGER', phone: '+1 973-555-0020' },
    { firstName: 'Robert', lastName: 'Diaz', email: 'rdiaz@pelicanshops.com', role: 'MANAGER', phone: '+1 732-555-0030' },
    { firstName: 'Jennifer', lastName: 'Walsh', email: 'jwalsh@pelicanshops.com', role: 'MANAGER', phone: '+1 215-555-0040' },
    // Asst. Managers (4)
    { firstName: 'Kevin', lastName: 'Murphy', email: 'kmurphy@pelicanshops.com', role: 'MANAGER', phone: '+1 908-555-0011' },
    { firstName: 'Lisa', lastName: 'Park', email: 'lpark@pelicanshops.com', role: 'MANAGER', phone: '+1 973-555-0021' },
    { firstName: 'Anthony', lastName: 'Russo', email: 'arusso@pelicanshops.com', role: 'MANAGER', phone: '+1 732-555-0031' },
    { firstName: 'Maria', lastName: 'Santos', email: 'msantos@pelicanshops.com', role: 'MANAGER', phone: '+1 215-555-0041' },
    // Sales - Spas & Hot Tubs (12)
    { firstName: 'James', lastName: 'O\'Brien', email: 'jobrien@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0100' },
    { firstName: 'Emily', lastName: 'Thompson', email: 'ethompson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0101' },
    { firstName: 'Daniel', lastName: 'Kim', email: 'dkim@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0102' },
    { firstName: 'Rachel', lastName: 'Gonzalez', email: 'rgonzalez@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0103' },
    { firstName: 'Christopher', lastName: 'Lee', email: 'clee@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0104' },
    { firstName: 'Amanda', lastName: 'Wilson', email: 'awilson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0105' },
    { firstName: 'Matthew', lastName: 'Brown', email: 'mbrown@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0106' },
    { firstName: 'Jessica', lastName: 'Davis', email: 'jdavis@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0107' },
    { firstName: 'Tyler', lastName: 'Martin', email: 'tmartin@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0108' },
    { firstName: 'Samantha', lastName: 'Taylor', email: 'staylor@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0109' },
    { firstName: 'Brandon', lastName: 'Anderson', email: 'banderson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0110' },
    { firstName: 'Nicole', lastName: 'White', email: 'nwhite@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0111' },
    // Sales - Pools (8)
    { firstName: 'Justin', lastName: 'Clark', email: 'jclark@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0200' },
    { firstName: 'Megan', lastName: 'Lewis', email: 'mlewis@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0201' },
    { firstName: 'Ryan', lastName: 'Hall', email: 'rhall@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0202' },
    { firstName: 'Lauren', lastName: 'Young', email: 'lyoung@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0203' },
    { firstName: 'Derek', lastName: 'Allen', email: 'dallen@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0204' },
    { firstName: 'Kayla', lastName: 'King', email: 'kking@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0205' },
    { firstName: 'Sean', lastName: 'Wright', email: 'swright@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0206' },
    { firstName: 'Brittany', lastName: 'Scott', email: 'bscott@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0207' },
    // Sales - Patio & Outdoor (8)
    { firstName: 'Patrick', lastName: 'Green', email: 'pgreen@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0300' },
    { firstName: 'Stephanie', lastName: 'Baker', email: 'sbaker@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0301' },
    { firstName: 'Andrew', lastName: 'Nelson', email: 'anelson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0302' },
    { firstName: 'Christina', lastName: 'Carter', email: 'ccarter@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0303' },
    { firstName: 'Marcus', lastName: 'Mitchell', email: 'mmitchell@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0304' },
    { firstName: 'Ashley', lastName: 'Roberts', email: 'aroberts@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0305' },
    { firstName: 'Evan', lastName: 'Turner', email: 'eturner@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0306' },
    { firstName: 'Vanessa', lastName: 'Phillips', email: 'vphillips@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0307' },
    // Sales - Winter Sports (8)
    { firstName: 'Jake', lastName: 'Campbell', email: 'jcampbell@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0400' },
    { firstName: 'Heather', lastName: 'Parker', email: 'hparker@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0401' },
    { firstName: 'Cody', lastName: 'Evans', email: 'cevans@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0402' },
    { firstName: 'Tiffany', lastName: 'Edwards', email: 'tedwards@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0403' },
    { firstName: 'Nathan', lastName: 'Collins', email: 'ncollins@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0404' },
    { firstName: 'Danielle', lastName: 'Stewart', email: 'dstewart@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0405' },
    { firstName: 'Brett', lastName: 'Morris', email: 'bmorris@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0406' },
    { firstName: 'Courtney', lastName: 'Rogers', email: 'crogers@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0407' },
    // Service Technicians (8)
    { firstName: 'Greg', lastName: 'Peterson', email: 'gpeterson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0500' },
    { firstName: 'Tony', lastName: 'Rivera', email: 'trivera@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0501' },
    { firstName: 'Frank', lastName: 'Cooper', email: 'fcooper@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0502' },
    { firstName: 'Steve', lastName: 'Richardson', email: 'srichardson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0503' },
    { firstName: 'Dave', lastName: 'Cox', email: 'dcox@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0504' },
    { firstName: 'Joe', lastName: 'Howard', email: 'jhoward@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0505' },
    { firstName: 'Mike', lastName: 'Ward', email: 'mward@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0506' },
    { firstName: 'Pete', lastName: 'Torres', email: 'ptorres@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0507' },
    // Installation Crew (6)
    { firstName: 'Carlos', lastName: 'Ramirez', email: 'cramirez@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0600' },
    { firstName: 'Jose', lastName: 'Hernandez', email: 'jhernandez@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0601' },
    { firstName: 'Miguel', lastName: 'Flores', email: 'mflores@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0602' },
    { firstName: 'Luis', lastName: 'Garcia', email: 'lgarcia@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0603' },
    { firstName: 'Ramon', lastName: 'Ortiz', email: 'rortiz@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0604' },
    { firstName: 'Diego', lastName: 'Morales', email: 'dmorales@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0605' },
    // Ski/Board Rental & Boot Fitters (6)
    { firstName: 'Alex', lastName: 'Schneider', email: 'aschneider@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0700' },
    { firstName: 'Zach', lastName: 'Fuller', email: 'zfuller@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0701' },
    { firstName: 'Hannah', lastName: 'Burke', email: 'hburke@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0702' },
    { firstName: 'Olivia', lastName: 'Jensen', email: 'ojensen@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0703' },
    { firstName: 'Max', lastName: 'Hoffman', email: 'mhoffman@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0704' },
    { firstName: 'Sophie', lastName: 'Klein', email: 'sklein@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0705' },
    // Warehouse (6)
    { firstName: 'Victor', lastName: 'Reyes', email: 'vreyes@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0800' },
    { firstName: 'Eddie', lastName: 'Woods', email: 'ewoods@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0801' },
    { firstName: 'Ray', lastName: 'Bennett', email: 'rbennett@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0802' },
    { firstName: 'Tommy', lastName: 'Gray', email: 'tgray@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0803' },
    { firstName: 'Phil', lastName: 'James', email: 'pjames@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0804' },
    { firstName: 'Will', lastName: 'Watson', email: 'wwatson@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0805' },
    // Cashiers (8)
    { firstName: 'Alyssa', lastName: 'Brooks', email: 'abrooks@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0900' },
    { firstName: 'Brianna', lastName: 'Price', email: 'bprice@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0901' },
    { firstName: 'Chloe', lastName: 'Barnes', email: 'cbarnes@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0902' },
    { firstName: 'Diana', lastName: 'Ross', email: 'dross@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0903' },
    { firstName: 'Elena', lastName: 'Foster', email: 'efoster@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-0904' },
    { firstName: 'Faith', lastName: 'Graham', email: 'fgraham@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-0905' },
    { firstName: 'Grace', lastName: 'Murray', email: 'gmurray@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-0906' },
    { firstName: 'Holly', lastName: 'Spencer', email: 'hspencer@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-0907' },
    // Customer Service (4)
    { firstName: 'Irene', lastName: 'Cole', email: 'icole@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-1000' },
    { firstName: 'Julia', lastName: 'Fox', email: 'jfox@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-1001' },
    { firstName: 'Karen', lastName: 'Bell', email: 'kbell@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-1002' },
    { firstName: 'Linda', lastName: 'Hunt', email: 'lhunt@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-1003' },
    // Delivery Drivers (4)
    { firstName: 'Marco', lastName: 'Silva', email: 'msilva@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 908-555-1100' },
    { firstName: 'Nick', lastName: 'Dunn', email: 'ndunn@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 973-555-1101' },
    { firstName: 'Oscar', lastName: 'Vega', email: 'ovega@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 732-555-1102' },
    { firstName: 'Pedro', lastName: 'Luna', email: 'pluna@pelicanshops.com', role: 'EMPLOYEE', phone: '+1 215-555-1103' },
  ];

  // Position assignments per employee index
  const posAssign = [
    null, // Agustin - Owner
    'Store Manager', 'Store Manager', 'Store Manager', 'Store Manager',
    'Asst. Manager', 'Asst. Manager', 'Asst. Manager', 'Asst. Manager',
    ...Array(12).fill('Sales - Spas & Hot Tubs'),
    ...Array(8).fill('Sales - Pools'),
    ...Array(8).fill('Sales - Patio & Outdoor'),
    ...Array(8).fill('Sales - Winter Sports'),
    ...Array(8).fill('Service Technician'),
    ...Array(6).fill('Installation Crew'),
    'Ski/Board Rental', 'Ski/Board Rental', 'Ski/Board Rental',
    'Boot Fitter', 'Boot Fitter', 'Boot Fitter',
    ...Array(6).fill('Warehouse'),
    ...Array(8).fill('Cashier'),
    ...Array(4).fill('Customer Service'),
    ...Array(4).fill('Delivery Driver'),
  ];

  // Location assignments: distribute evenly across 4 stores
  const locCycle = [whitehouse.id, morrisPlains.id, eastBrunswick.id, quakertown.id];

  const createdUsers = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const user = await prisma.user.create({
      data: {
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        passwordHash: hash,
        role: emp.role,
        phone: emp.phone,
        organizationId: org.id,
      },
    });
    createdUsers.push({ ...user, posName: posAssign[i], locId: locCycle[i % 4] });
  }
  console.log(`Created ${createdUsers.length} employees`);

  // Generate shifts for 2 weeks: current week and next
  console.log('Generating shifts...');
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const shiftTemplates = [
    { start: 8, end: 16, label: 'Morning' },
    { start: 9, end: 17, label: 'Day' },
    { start: 10, end: 18, label: 'Mid' },
    { start: 12, end: 20, label: 'Afternoon' },
    { start: 7, end: 15, label: 'Early' },
    { start: 11, end: 19, label: 'Late Morning' },
  ];

  let shiftCount = 0;
  for (let week = 0; week < 2; week++) {
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + week * 7);

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + dayOffset);
      const isWeekend = dayOffset >= 5;

      for (const u of createdUsers) {
        if (u.role === 'OWNER') continue; // Owner doesn't get shifts

        // Weekends: ~40% of staff works
        if (isWeekend && Math.random() > 0.4) continue;
        // Weekdays: ~75% of staff works each day
        if (!isWeekend && Math.random() > 0.75) continue;

        const template = shiftTemplates[Math.floor(Math.random() * shiftTemplates.length)];
        const startTime = new Date(day);
        startTime.setHours(template.start, 0, 0, 0);
        const endTime = new Date(day);
        endTime.setHours(template.end, 0, 0, 0);

        await prisma.shift.create({
          data: {
            startTime,
            endTime,
            notes: Math.random() > 0.7 ? template.label + ' shift' : null,
            status: week === 0 ? 'PUBLISHED' : 'DRAFT',
            organizationId: org.id,
            userId: u.id,
            positionId: u.posName ? posMap[u.posName] : null,
            locationId: u.locId,
          },
        });
        shiftCount++;
      }
    }
  }
  console.log(`Created ${shiftCount} shifts`);

  // Create some availability records
  console.log('Creating availability records...');
  for (const u of createdUsers) {
    if (u.role === 'OWNER') continue;
    for (let day = 0; day < 7; day++) {
      const isWeekend = day === 0 || day === 6;
      // Some people unavailable on weekends
      if (isWeekend && Math.random() > 0.5) {
        await prisma.availability.create({
          data: { userId: u.id, dayOfWeek: day, startTime: '00:00', endTime: '00:00', available: false },
        });
      } else {
        const start = 7 + Math.floor(Math.random() * 3);
        const end = start + 8 + Math.floor(Math.random() * 2);
        await prisma.availability.create({
          data: { userId: u.id, dayOfWeek: day, startTime: `${String(start).padStart(2, '0')}:00`, endTime: `${String(end).padStart(2, '0')}:00`, available: true },
        });
      }
    }
  }

  // Create some time-off requests
  console.log('Creating time-off requests...');
  const reasons = ['Family vacation', 'Medical appointment', 'Personal day', 'Moving', 'Wedding', 'Jury duty', 'Child school event'];
  const statuses = ['PENDING', 'APPROVED', 'DENIED'];
  for (let i = 0; i < 25; i++) {
    const u = createdUsers[Math.floor(Math.random() * createdUsers.length)];
    if (u.role === 'OWNER') continue;
    const startDate = new Date(monday);
    startDate.setDate(startDate.getDate() + Math.floor(Math.random() * 21));
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1 + Math.floor(Math.random() * 3));

    await prisma.timeOffRequest.create({
      data: {
        userId: u.id,
        startDate,
        endDate,
        reason: reasons[Math.floor(Math.random() * reasons.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)],
      },
    });
  }

  // Create some messages
  console.log('Creating messages...');
  const channels = ['general', 'whitehouse', 'morris-plains', 'east-brunswick', 'quakertown', 'managers'];
  const msgs = [
    'Good morning team!', 'Reminder: inventory count this Friday',
    'New Sundance shipment arriving Thursday', 'Who can cover the afternoon shift tomorrow?',
    'Great sales numbers this week!', 'Pool chemicals delivery delayed to Monday',
    'Staff meeting at 9am sharp', 'BBQ display needs restocking',
    'Customer left a great review!', 'Anyone want to swap shifts Saturday?',
    'Training session for new POS system next Tuesday', 'Snow in the forecast - expect busy ski dept',
    'Hot tub demo event this weekend', 'Please update your availability for next month',
    'Congrats to East Brunswick for hitting sales target!', 'Reminder: park in the back lot',
  ];
  for (const msg of msgs) {
    const u = createdUsers[Math.floor(Math.random() * Math.min(9, createdUsers.length))];
    const hoursAgo = Math.floor(Math.random() * 168);
    const createdAt = new Date();
    createdAt.setHours(createdAt.getHours() - hoursAgo);
    await prisma.message.create({
      data: {
        userId: u.id,
        channel: channels[Math.floor(Math.random() * channels.length)],
        content: msg,
        createdAt,
      },
    });
  }

  console.log('Seed complete!');
  console.log(`Login: agustin@pelicanshops.com / pelican2024`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
