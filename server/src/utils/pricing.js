function nightsBetween(checkIn, checkOut) {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const nights = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  return Math.max(nights, 0);
}

function calculatePrice(room, checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);
  return nights * room.pricePerNight;
}

module.exports = { calculatePrice, nightsBetween };
