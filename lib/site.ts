export const WHATSAPP_NUMBER = "9779708538395";
export const INQUIRY_EMAIL = "jikmisdonkhang@gmail.com";
export const FORMSPREE_ENDPOINT =
  process.env.NEXT_PUBLIC_FORMSPREE_ENDPOINT || "https://formspree.io/f/xvzepwkw";

export function calculateNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const nights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
  return Number.isFinite(nights) && nights > 0 ? nights : 0;
}
