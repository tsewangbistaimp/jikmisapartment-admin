const { PrismaClient, Role, RoomType } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
});
const prisma = new PrismaClient({ adapter });

// Real Jikmis Apartment rooms, pricing, and unit counts — sourced from
// /ai-knowledge-base (02_Room_Types.md, 03_Pricing.md, 04_Amenities.md),
// which is itself sourced from the live site and AI receptionist data.
// The previous version of this file seeded unrelated placeholder rooms
// ("Boudha View Studio" etc.) left over from the original portfolio
// template — those never matched the real property and have been replaced.
async function main() {
  // The seeded Owner/Admin email/name/password are configurable via env vars
  // so a real deployment's admin identity is never hardcoded in source
  // control. The fallbacks below only exist for local/dev seeding
  // convenience — change the password immediately after first login via
  // PATCH /auth/password, or set SEED_ADMIN_PASSWORD before seeding a real
  // environment.
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      "[seed] SEED_ADMIN_PASSWORD is not set — using the insecure default dev password 'admin12345'. " +
        "Set SEED_ADMIN_PASSWORD in a real deployment, and change the password after first login regardless."
    );
  }
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || "admin12345", 12);
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@jikmis.com";
  const adminName = process.env.SEED_ADMIN_NAME || "Jikmis Admin";

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash, name: adminName, role: Role.ADMIN, isActive: true },
    create: {
      name: adminName,
      email: adminEmail,
      phone: "+9779708538395",
      passwordHash,
      role: Role.ADMIN
    }
  });

  const sharedFacilities = [
    "Free WiFi",
    "24/7 hot water",
    "Housekeeping twice a week",
    "Rooftop view",
    "Motorbike parking",
    "CCTV",
    "Self-service laundry (NPR 200 per load)"
  ];
  const houseRules = [
    "Check-in from 2:00 PM",
    "Check-out before 12:00 PM",
    "No smoking indoors",
    "Pets not allowed",
    "Quiet hours 10:00 PM - 7:00 AM"
  ];

  const rooms = [
    {
      title: "Single Studio Room",
      type: RoomType.SINGLE,
      pricePerNight: 1500,
      pricePerMonth: 37000,
      maxGuests: 2,
      totalUnits: 2,
      description:
        "A calm furnished studio with warm wooden floors, a queen bed, private bathroom, and a compact kitchen setup. Best for 1-2 guests.",
      facilities: ["Queen bed", "Private bathroom", "Kitchen setup", "Table and chair", "Fridge", "Fan", "Utensils", ...sharedFacilities],
      rules: houseRules,
      images: ["/images/jikmis/single-studio-bedroom.jpeg", "/images/jikmis/single-studio-kitchen.jpeg"]
    },
    {
      title: "Double Studio Room",
      type: RoomType.DOUBLE,
      pricePerNight: 2500,
      pricePerMonth: 47000,
      maxGuests: 3,
      totalUnits: 2,
      description:
        "A bright double studio with generous sleeping space, seating, kitchen area, and a hot-water bathroom. Best for 2-3 guests.",
      facilities: ["2 twin beds", "Private bathroom", "Kitchen setup", "Table and chair", "Sofa", "Fridge", "Fan", "Utensils", ...sharedFacilities],
      rules: houseRules,
      images: [
        "/images/jikmis/double-studio-bedroom.jpeg",
        "/images/jikmis/double-studio-lounge.jpeg",
        "/images/jikmis/double-studio-bathroom.jpeg"
      ]
    },
    {
      title: "Family Room",
      type: RoomType.FAMILY,
      pricePerNight: 4000,
      pricePerMonth: 65000,
      maxGuests: 5,
      totalUnits: 1,
      description:
        "A spacious 2BHK family apartment with two bedrooms (king-size beds), two bathrooms, a living area, and a dining corner. Best for 4-5 guests.",
      facilities: ["2 king-size beds (2 bedrooms)", "2 bathrooms", "Kitchen", "Sofa", "Chair", "Table", "Dining area", "Fridge", ...sharedFacilities],
      rules: houseRules,
      images: [
        "/images/jikmis/family-room-bedroom.jpeg",
        "/images/jikmis/family-room-living.jpeg",
        "/images/jikmis/family-room-second-bedroom.jpeg",
        "/images/jikmis/family-room-sunroom.jpeg"
      ]
    }
  ];

  for (const room of rooms) {
    const id = room.title.toLowerCase().replaceAll(" ", "-");
    await prisma.room.upsert({
      where: { id },
      update: room,
      create: { id, ...room }
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
