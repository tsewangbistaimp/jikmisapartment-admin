"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bath,
  BedDouble,
  Bot,
  Building2,
  Calendar,
  Camera,
  Car,
  Check,
  ChefHat,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Coffee,
  HeartHandshake,
  Home as HomeIcon,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Plane,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  X
} from "lucide-react";
import ApartmentChatbot from "@/components/ApartmentChatbot";
import { calculateNights, FORMSPREE_ENDPOINT, INQUIRY_EMAIL, WHATSAPP_NUMBER } from "@/lib/site";
import { api, currency, Room } from "@/lib/api";

const apartmentVideos = [
  {
    src: "/videos/jikmis-apartment-tour-1.mp4",
    poster: "/images/jikmis/single-studio-bedroom.jpeg",
    title: "Family / 2BHK",
    roomTitle: "Family Room"
  },
  {
    src: "/videos/jikmis-apartment-tour-2.mp4",
    poster: "/images/jikmis/double-studio-lounge.jpeg",
    title: "Single Studio",
    roomTitle: "Single Studio"
  },
  {
    src: "/videos/jikmis-apartment-tour-3.mp4",
    poster: "/images/jikmis/family-room-living.jpeg",
    title: "Double Studio",
    roomTitle: "Double Studio"
  }
];

const roomShowcase = [
  {
    title: "Single Studio",
    price: "NPR 1,500 / day",
    monthly: "NPR 37,000 / month",
    guests: "1-2 guests",
    description: "A calm furnished studio with warm wooden floors, private bathroom, and a compact kitchen setup.",
    images: ["/images/jikmis/single-studio-bedroom.jpeg", "/images/jikmis/single-studio-kitchen.jpeg"],
    amenities: ["Queen bed", "Kitchen setup", "Private bathroom", "Free WiFi"]
  },
  {
    title: "Double Studio",
    price: "NPR 2,500 / day",
    monthly: "NPR 47,000 / month",
    guests: "2-3 guests",
    description: "A bright double studio with generous sleeping space, seating, kitchen area, and hot-water bathroom.",
    images: [
      "/images/jikmis/double-studio-bedroom.jpeg",
      "/images/jikmis/double-studio-lounge.jpeg",
      "/images/jikmis/double-studio-bathroom.jpeg"
    ],
    amenities: ["Twin beds", "Seating area", "Kitchen setup", "24/7 hot water"]
  },
  {
    title: "Family Room",
    price: "NPR 4,000 / day",
    monthly: "NPR 65,000 / month",
    guests: "Families or groups",
    description: "A spacious family apartment with separate bedroom areas, lounge space, dining corner, and Boudha light.",
    images: [
      "/images/jikmis/family-room-bedroom.jpeg",
      "/images/jikmis/family-room-living.jpeg",
      "/images/jikmis/family-room-second-bedroom.jpeg",
      "/images/jikmis/family-room-sunroom.jpeg"
    ],
    amenities: ["Family layout", "Living area", "Kitchen setup", "Large windows"]
  }
];

const amenities = [
  { icon: Wifi, title: "Free WiFi", text: "Reliable internet included for every stay." },
  { icon: Bath, title: "24/7 Hot Water", text: "Comfortable bathrooms with hot water access." },
  { icon: ChefHat, title: "Kitchen Setup", text: "Basic kitchen essentials for easy daily living." },
  { icon: Sparkles, title: "Cleaning Service", text: "Housekeeping support twice a week." },
  { icon: ShieldCheck, title: "Secure Stay", text: "Comfort-focused serviced apartment environment." },
  { icon: Car, title: "Motorbike Parking", text: "Convenient parking for guests with bikes." }
];

const attractions = [
  { icon: MapPin, title: "Boudhanath Stupa", text: "A short walk to one of Kathmandu's most loved landmarks." },
  { icon: Coffee, title: "Cafes & Restaurants", text: "Easy access to local cafes, shops, and dining." },
  { icon: Plane, title: "Airport Access", text: "Convenient route to Tribhuvan International Airport." },
  { icon: Building2, title: "Daily Essentials", text: "Public transport, markets, and daily needs nearby." }
];

const galleryImages = [
  "/images/jikmis/single-studio-bedroom.jpeg",
  "/images/jikmis/single-studio-kitchen.jpeg",
  "/images/jikmis/double-studio-bedroom.jpeg",
  "/images/jikmis/double-studio-lounge.jpeg",
  "/images/jikmis/family-room-bedroom.jpeg",
  "/images/jikmis/family-room-living.jpeg",
  "/images/jikmis/family-room-second-bedroom.jpeg",
  "/images/jikmis/family-room-sunroom.jpeg",
  "/images/jikmis/gallery/jikmis-gallery-1736.jpg",
  "/images/jikmis/gallery/jikmis-gallery-1737.jpg",
  "/images/jikmis/gallery/jikmis-gallery-1738.jpg",
  "/images/jikmis/gallery/jikmis-rooftop-stupa-sunset.jpg",
  "/images/jikmis/gallery/jikmis-rooftop-yoga-view.jpg",
  "/images/jikmis/gallery/jikmis-rooftop-terrace-view.jpg"
];

const propertyImages = galleryImages.filter(
  (image) => !roomShowcase.some((room) => room.images.includes(image))
);

const cafeImages = [
  {
    src: "/images/jikmis/cafe/jikmis-cafe-main.jpg",
    alt: "Warm seating area inside Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-window.jpg",
    alt: "Window seating and wooden tables at Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-cozy-seating.jpg",
    alt: "Cozy Jikmis Cafe seating with warm wooden furniture"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-counter.jpg",
    alt: "Coffee counter and pastry display at Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-iced-coffee.jpg",
    alt: "Iced coffee on a wooden table at Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-orange-coffee.jpg",
    alt: "Cold coffee with orange garnish at Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-mango-drink.jpg",
    alt: "Colorful mango iced drink at Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-berry-drink.jpg",
    alt: "Berry iced drink served at Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-table-corner.jpg",
    alt: "Wooden table corner inside Jikmis Cafe"
  },
  {
    src: "/images/jikmis/cafe/jikmis-cafe-lounge.jpg",
    alt: "Bright lounge seating at Jikmis Cafe"
  }
];

const popularCafeMenu = [
  "☕ Cappuccino",
  "☕ Café Latte",
  "🧊 Iced Latte",
  "🥤 Fresh Lemon Soda",
  "🥐 Bakery Items",
  "🍰 Cheesecake"
];

const cafeMenu = [
  { category: "Coffee", items: ["Espresso", "Americano", "Cappuccino", "Café Latte", "Mocha"] },
  { category: "Tea", items: ["Masala Tea", "Green Tea", "Lemon Tea", "Tibetan Butter Tea"] },
  { category: "Cold Drinks", items: ["Iced Latte", "Fresh Lemon Soda", "Mango Smoothie", "Seasonal Cooler"] },
  { category: "Bakery", items: ["Butter Croissant", "Cheesecake", "Chocolate Cake", "Brownie", "Fresh Bakery Items"] }
];

export default function Home() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [isCafeMenuOpen, setIsCafeMenuOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    roomType: roomShowcase[0].title,
    checkIn: "",
    checkOut: "",
    guests: ""
  });
  const [bookingStatus, setBookingStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [bookingMessage, setBookingMessage] = useState("");
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [contactDetails, setContactDetails] = useState({ name: "", email: "", phone: "" });
  // Real Room rows from the database (same table /admin reads), fetched once
  // on mount, so the booking form's submit step can resolve the marketing
  // roomShowcase title ("Single Studio", etc.) to a real Room.id instead of
  // guessing — see resolveDbRoom below. roomShowcase itself stays exactly as
  // it is (rich marketing copy/images with no database equivalent); only the
  // booking form's submission needs a real room record.
  const [dbRooms, setDbRooms] = useState<Room[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; title: string; index: number } | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState("about");

  useEffect(() => {
    const updateScrollState = () => setIsScrolled(window.scrollY > 24);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState);
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  // Non-blocking: if this fails (API down, etc.), the page still works —
  // handleBookingSubmit below falls back to a clear error message rather
  // than crashing, the same resilience pattern used everywhere else guest
  // booking touches the database (see lib/bookingAssistant.ts).
  useEffect(() => {
    api<{ rooms: Room[] }>("/rooms?available=true")
      .then((data) => setDbRooms(data.rooms))
      .catch(() => setDbRooms([]));
  }, []);

  useEffect(() => {
    const revealElements = Array.from(document.querySelectorAll(".reveal"));
    if (revealElements.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      revealElements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -80px 0px", threshold: 0.12 }
    );

    revealElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sectionIds = ["about", "rooms", "contact"];
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveMobileTab(entry.target.id);
          }
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivePhoto((current) => current + 1);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isCafeMenuOpen) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    const getFocusableElements = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".cafe-modal button, .cafe-modal [href], .cafe-modal input, .cafe-modal select, .cafe-modal textarea, .cafe-modal [tabindex]:not([tabindex='-1'])"
        )
      ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCafeMenuOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (!focusableElements.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => document.querySelector<HTMLElement>(".cafe-modal-close")?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [isCafeMenuOpen]);

  useEffect(() => {
    if (!isBookingModalOpen) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;

    const getFocusableElements = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".booking-modal button, .booking-modal [href], .booking-modal input, .booking-modal select, .booking-modal textarea, .booking-modal [tabindex]:not([tabindex='-1'])"
        )
      ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsBookingModalOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      if (!focusableElements.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => document.querySelector<HTMLElement>(".booking-modal-close")?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [isBookingModalOpen]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (!lightbox) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightbox(null);
      } else if (event.key === "ArrowRight") {
        setLightbox((current) => (current ? { ...current, index: (current.index + 1) % current.images.length } : current));
      } else if (event.key === "ArrowLeft") {
        setLightbox((current) =>
          current ? { ...current, index: (current.index - 1 + current.images.length) % current.images.length } : current
        );
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [lightbox]);

  const heroImage = useMemo(() => roomShowcase[2].images[activePhoto % roomShowcase[2].images.length], [activePhoto]);
  const nightsPreview = calculateNights(bookingForm.checkIn, bookingForm.checkOut);

  function scrollToBookingForm(roomTitle?: string) {
    if (roomTitle) {
      setBookingForm((current) => ({ ...current, roomType: roomTitle }));
    }
    window.setTimeout(() => {
      const bookingFormElement = document.getElementById("booking-form");
      bookingFormElement?.scrollIntoView({ behavior: "smooth", block: "start" });
      bookingFormElement?.querySelector<HTMLElement>("select, input")?.focus({ preventScroll: true });
    }, 0);
  }

  // roomShowcase's short display titles ("Single Studio") vs. the database's
  // full Room.title ("Single Studio Room") — a controlled, 3-item list, so a
  // simple startsWith match is reliable (mirrors the alias-matching idea
  // already used by the AI chat's ROOM_TYPE_ALIASES, just simpler since
  // there's only ever one real Room per showcase entry).
  function resolveDbRoom(showcaseTitle: string): Room | undefined {
    return dbRooms.find((room) => room.title.startsWith(showcaseTitle));
  }

  async function handleBookingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const { roomType, checkIn, checkOut, guests } = bookingForm;
    const { name, email, phone } = contactDetails;
    const nights = calculateNights(checkIn, checkOut);
    const nightsLine = nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "—";
    const fallbackWhatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
      `Hello Jikmis Apartment, I would like to check availability.\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nRoom type: ${roomType}\nCheck-in: ${checkIn}\nCheck-out: ${checkOut}\nNights: ${nightsLine}\nGuests: ${guests}`
    )}`;

    const dbRoom = resolveDbRoom(roomType);

    // Real room data hasn't loaded yet (or the API is unreachable) — never
    // silently fail. Fall back to the form's original email+WhatsApp-only
    // path so the guest's request is never lost, same as before this form
    // was connected to the database.
    if (!dbRoom) {
      setBookingStatus("sending");
      setBookingMessage("Sending your request...");
      try {
        const response = await fetch(FORMSPREE_ENDPOINT, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            _subject: "New Jikmis Apartment availability request (room lookup unavailable)",
            name,
            email,
            phone,
            roomType,
            checkIn,
            checkOut,
            nights: nightsLine,
            guests,
            _replyto: email
          })
        });
        if (!response.ok) throw new Error("Email could not be sent.");
        setBookingStatus("success");
        setBookingMessage("We couldn't verify live availability just now, so we've emailed your request to our team directly — they'll confirm shortly.");
      } catch {
        setBookingStatus("error");
        setBookingMessage("Opened WhatsApp, but the email could not be sent. Please also message us directly.");
      } finally {
        window.open(fallbackWhatsappUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }

    // The real, database-backed path: validates dates, checks availability,
    // calculates price, creates the booking, and sends the guest's
    // confirmation — see app/api/bookings/route.ts and
    // lib/bookingAssistant.ts's createDirectBooking(). This is the same
    // Booking table /admin and /admin/calendar read from.
    setBookingStatus("sending");
    setBookingMessage("Checking availability and booking your stay...");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: dbRoom.id,
          checkIn,
          checkOut,
          guests: Number(guests),
          fullName: name,
          phone,
          whatsapp: phone,
          email
        })
      });
      const data = await response.json();

      if (!response.ok) {
        setBookingStatus("error");
        setBookingMessage(data.message || "We couldn't complete your booking. Please try again or contact us directly.");
        return;
      }

      setBookingStatus("success");
      setBookingMessage(
        `Booking confirmed — reference ${data.bookingId}. ${data.roomTitle}, ${nightsLine}, total ${currency(data.totalPrice)}. A confirmation email is on its way to ${email}.${data.capacityNote ? ` ${data.capacityNote}` : ""}`
      );
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setBookingStatus("error");
      setBookingMessage("We couldn't reach our booking system. Please try again in a moment, or WhatsApp/call us directly.");
    }
  }

  const mobileTabOrder = ["about", "rooms", "chat", "contact", "menu"];
  const todayIso = new Date().toISOString().split("T")[0];
  const activeMobileTabKey = isMobileMenuOpen ? "menu" : activeMobileTab;

  return (
    <main className="apartment-site luxury-site">
      <header className={`site-header luxury-nav ${isScrolled ? "is-scrolled" : ""}`}>
        <Link className="brand" href="/" onClick={() => setIsMobileMenuOpen(false)}>
          <span className="brand-mark">JK</span>
          <span>Jikmis Apartment</span>
        </Link>
        <nav aria-label="Main navigation" className="desktop-nav">
          <a href="#about">About</a>
          <a href="#rooms">Rooms</a>
          <a href="#cafe">Café</a>
          <a href="#amenities">Amenities</a>
          <a href="#nearby">Nearby</a>
          <a href="#tour">Tour</a>
          <a href="#contact">Contact</a>
        </nav>
        <div className="header-actions">
          <button type="button" className="nav-book-button" onClick={() => setIsBookingModalOpen(true)}>
            <Send size={15} /> <span>Book Now</span>
          </button>
        </div>
      </header>

      <section className="luxury-hero airbnb-hero">
        <img className="luxury-hero-image" src={heroImage} alt="Luxury serviced apartment at Jikmis Apartment" />
        <div className="luxury-hero-overlay airbnb-hero-overlay" />

        <div className="luxury-hero-content airbnb-hero-content">
          <h1>Jikmis Apartment.</h1>
          <p>
            Serviced studios and family apartments with warm interiors, private kitchens, hot water, and direct booking
            assistance in the heart of Boudha.
          </p>
          <div className="hero-actions airbnb-hero-actions">
            <a className="button airbnb-explore" href="#rooms">
              Explore Rooms <ArrowRight size={18} />
            </a>
          </div>
        </div>
      </section>

      <section className="section-shell luxury-about reveal" id="about">
        <div>
          <p className="eyebrow">About Jikmis</p>
          <h2>A quiet serviced apartment designed for comfort in Boudha.</h2>
        </div>
        <div className="about-copy">
          <p>
            Jikmis Apartment offers fully furnished serviced apartments for short stays, long stays, families,
            students, and guests who want a calm base near Boudhanath Stupa.
          </p>
          <div className="about-stat-row">
            <span><BedDouble size={18} /> Studio & family rooms</span>
            <span><Bath size={18} /> 24/7 hot water</span>
            <span><HeartHandshake size={18} /> Direct booking help</span>
          </div>
        </div>
      </section>

      <section className="section-shell reveal" id="rooms">
        <div className="section-heading centered-heading">
          <p className="eyebrow">Apartment Showcase</p>
          <h2>Choose your space in Boudha.</h2>
          <p>Clean, warm, and practical rooms with premium simplicity and direct monthly pricing.</p>
        </div>
        <div className="luxury-room-grid">
          {roomShowcase.map((room, index) => {
            const image = room.images[activePhoto % room.images.length];
            return (
              <article
                className="luxury-room-card reveal"
                key={room.title}
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <button
                  type="button"
                  className="room-image-frame"
                  onClick={() => setLightbox({ images: room.images, title: room.title, index: 0 })}
                  aria-label={`View all ${room.images.length} photos of ${room.title}`}
                >
                  <img src={image} alt={`${room.title} at Jikmis Apartment`} loading="lazy" />
                  <span className="room-chip">{room.guests}</span>
                  <span className="photo-count-badge">
                    <Camera size={14} /> {room.images.length}
                  </span>
                </button>
                <div className="luxury-room-body">
                  <div className="room-title-row">
                    <h3>{room.title}</h3>
                    <span>{index === 2 ? "Family" : "Studio"}</span>
                  </div>
                  <p>{room.description}</p>
                  <div className="room-price-row">
                    <strong>{room.price}</strong>
                    <span>{room.monthly}</span>
                  </div>
                  <ul className="room-amenity-list">
                    {room.amenities.map((amenity) => (
                      <li key={amenity}><Check size={15} /> {amenity}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="button primary room-book-button"
                    onClick={() => scrollToBookingForm(room.title)}
                  >
                    <Send size={16} /> Book {room.title}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-shell video-showcase reveal" id="tour">
        <div className="section-heading centered-heading">
          <p className="eyebrow">Apartment Tour</p>
          <h2>Step inside Jikmis Apartment.</h2>
          <p>Watch each room, then browse its full photo set below.</p>
        </div>
        <div className="video-showcase-grid">
          {apartmentVideos.map((video) => (
            <div className="video-card" key={video.src}>
              <video
                src={video.src}
                poster={video.poster}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
              />
              <span className="video-card-caption">{video.title}</span>
              <button
                type="button"
                className="video-card-book-button"
                onClick={() => scrollToBookingForm(video.roomTitle)}
              >
                <Send size={13} /> Book
              </button>
            </div>
          ))}
        </div>

        <div className="tour-photo-groups">
          {roomShowcase.map((room) => (
            <div className="tour-photo-group" key={room.title}>
              <div className="tour-photo-group-heading">
                <h3>{room.title}</h3>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => scrollToBookingForm(room.title)}
                >
                  Book this room
                </button>
              </div>
              <div className="tour-photo-grid">
                {room.images.map((image, photoIndex) => (
                  <button
                    type="button"
                    className="tour-photo-tile"
                    key={image}
                    onClick={() => setLightbox({ images: room.images, title: room.title, index: photoIndex })}
                    aria-label={`View ${room.title} photo ${photoIndex + 1} of ${room.images.length}`}
                  >
                    <img src={image} alt={`${room.title} photo ${photoIndex + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {propertyImages.length > 0 ? (
            <div className="tour-photo-group">
              <div className="tour-photo-group-heading">
                <h3>Property &amp; Rooftop</h3>
              </div>
              <div className="tour-photo-grid">
                {propertyImages.map((image, photoIndex) => (
                  <button
                    type="button"
                    className="tour-photo-tile"
                    key={image}
                    onClick={() =>
                      setLightbox({ images: propertyImages, title: "Property & Rooftop", index: photoIndex })
                    }
                    aria-label={`View property photo ${photoIndex + 1} of ${propertyImages.length}`}
                  >
                    <img src={image} alt={`Jikmis Apartment property photo ${photoIndex + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section-shell cafe-section reveal" id="cafe">
        <div className="cafe-grid">
          <div className="cafe-media">
            <button
              type="button"
              className="cafe-main-frame"
              onClick={() =>
                setLightbox({ images: cafeImages.map((image) => image.src), title: "Jikmis Café", index: 0 })
              }
              aria-label={`View all ${cafeImages.length} Jikmis Café photos`}
            >
              <img src={cafeImages[0].src} alt={cafeImages[0].alt} loading="lazy" />
              <span className="photo-count-badge">
                <Camera size={14} /> {cafeImages.length}
              </span>
            </button>
            <div className="cafe-photo-strip" aria-label="Jikmis Café photo preview">
              {cafeImages.slice(1).map((image, index) => (
                <button
                  type="button"
                  className="cafe-thumb"
                  key={image.src}
                  onClick={() =>
                    setLightbox({ images: cafeImages.map((item) => item.src), title: "Jikmis Café", index: index + 1 })
                  }
                  aria-label={`View Jikmis Café photo ${index + 2} of ${cafeImages.length}`}
                >
                  <img src={image.src} alt={image.alt} loading="lazy" />
                </button>
              ))}
            </div>
          </div>

          <div className="cafe-content">
            <div className="cafe-topline">
              <p className="eyebrow"><Coffee size={16} /> Jikmis Café</p>
              <span className="cafe-badge">Open Daily</span>
            </div>
            <h2>☕ Jikmis Café</h2>
            <p className="cafe-subtitle">Fresh Coffee • Cold Drinks • Bakery Items</p>
            <p>
              Take a break and enjoy freshly brewed coffee, refreshing cold drinks, and fresh bakery items at Jikmis
              Café. Whether you are starting your morning, working remotely, or relaxing after exploring Boudha, our
              cozy café offers a warm and peaceful atmosphere for every guest.
            </p>

            <div className="cafe-menu-card">
              <span>Popular Menu</span>
              <div className="cafe-popular-list">
                {popularCafeMenu.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>

            <div className="cafe-footer-row">
              <strong>Available for Apartment Guests & Visitors</strong>
              <button className="button primary" type="button" onClick={() => setIsCafeMenuOpen(true)}>
                View Full Menu
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section-band luxury-band reveal" id="amenities">
        <div className="section-shell">
          <div className="section-heading centered-heading">
            <p className="eyebrow">Amenities</p>
            <h2>Everything needed for an easy stay.</h2>
          </div>
          <div className="facility-grid">
            {amenities.map((item, index) => {
              const Icon = item.icon;
              return (
                <article
                  className="facility-card premium-card reveal"
                  key={item.title}
                  style={{ transitionDelay: `${index * 70}ms` }}
                >
                  <Icon size={24} />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section-shell nearby-section reveal" id="nearby">
        <div className="section-heading">
          <p className="eyebrow">Nearby Attractions</p>
          <h2>Stay close to the best of Boudha.</h2>
          <p>Walk to the stupa, find cafes easily, and keep airport access simple.</p>
        </div>
        <div className="nearby-grid">
          {attractions.map((item, index) => {
            const Icon = item.icon;
            return (
              <article
                className="nearby-card reveal"
                key={item.title}
                style={{ transitionDelay: `${index * 70}ms` }}
              >
                <Icon size={22} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="contact-section luxury-contact booking-section reveal" id="contact">
        <div className="contact-intro">
          <p className="eyebrow">Direct Booking</p>
          <h2>Ready to check availability?</h2>
          <p>
            Share your dates, apartment type, number of guests, and contact details below, or reach us directly. Every
            request goes to our WhatsApp and email at the same time.
          </p>
          <div className="contact-actions">
            <a className="button primary" href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer">
              <MessageCircle size={18} /> WhatsApp +{WHATSAPP_NUMBER}
            </a>
            <a className="button secondary" href={`tel:+${WHATSAPP_NUMBER}`}>
              <Phone size={18} /> Call +{WHATSAPP_NUMBER}
            </a>
          </div>
        </div>

        <form className="booking-panel form-card" id="booking-form" onSubmit={handleBookingSubmit}>
          <p className="booking-panel-title">Book in seconds</p>
          <div className="form-grid-2">
            <label>
              Room Type
              <select
                value={bookingForm.roomType}
                onChange={(event) => setBookingForm((current) => ({ ...current, roomType: event.target.value }))}
                required
              >
                {roomShowcase.map((room) => (
                  <option key={room.title} value={room.title}>
                    {room.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Guests
              <input
                type="number"
                min="1"
                placeholder="Add guests"
                value={bookingForm.guests}
                onChange={(event) => setBookingForm((current) => ({ ...current, guests: event.target.value }))}
                required
              />
            </label>
            <label>
              Check in
              <span className="date-field">
                <Calendar size={16} className="date-field-icon" aria-hidden="true" />
                <input
                  type="date"
                  min={todayIso}
                  value={bookingForm.checkIn}
                  onChange={(event) => {
                    const nextCheckIn = event.target.value;
                    setBookingForm((current) => ({
                      ...current,
                      checkIn: nextCheckIn,
                      checkOut: current.checkOut && current.checkOut <= nextCheckIn ? "" : current.checkOut
                    }));
                  }}
                  required
                />
              </span>
            </label>
            <label>
              Check out
              <span className="date-field">
                <Calendar size={16} className="date-field-icon" aria-hidden="true" />
                <input
                  type="date"
                  min={bookingForm.checkIn || todayIso}
                  value={bookingForm.checkOut}
                  onChange={(event) => setBookingForm((current) => ({ ...current, checkOut: event.target.value }))}
                  required
                />
              </span>
            </label>
          </div>
          {nightsPreview > 0 ? (
            <p className="nights-preview">
              {nightsPreview} night{nightsPreview === 1 ? "" : "s"} total
            </p>
          ) : null}
          <label>
            Full Name
            <input
              type="text"
              placeholder="Your name"
              value={contactDetails.name}
              onChange={(event) => setContactDetails((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <div className="form-grid-2">
            <label>
              Email
              <input
                type="email"
                placeholder="you@example.com"
                value={contactDetails.email}
                onChange={(event) => setContactDetails((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Phone Number
              <input
                type="tel"
                placeholder="+977..."
                value={contactDetails.phone}
                onChange={(event) => setContactDetails((current) => ({ ...current, phone: event.target.value }))}
                required
              />
            </label>
          </div>
          <button className="button primary" type="submit" disabled={bookingStatus === "sending"}>
            <Send size={18} /> {bookingStatus === "sending" ? "Booking..." : "Book Now"}
          </button>
          {bookingMessage ? (
            <p className={`message ${bookingStatus === "error" ? "error" : "success"}`} role="status">
              {bookingMessage}
            </p>
          ) : null}
        </form>
      </section>

      <section className="section-shell map-section reveal" id="map">
        <div className="section-heading centered-heading">
          <p className="eyebrow">Find Us</p>
          <h2>Jikmis Apartment near Boudhanath.</h2>
          <p>Open the map for directions to our serviced apartments in Boudha, Kathmandu.</p>
        </div>
        <div className="map-card">
          <iframe
            title="Jikmis Apartment Google Map"
            src="https://www.google.com/maps?q=Jikmis%20Apartment%20Boudha%20Kathmandu&output=embed"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <a className="button primary map-button" href="https://maps.app.goo.gl/aRgUNak3RATee21c8" target="_blank" rel="noreferrer">
            <MapPin size={18} /> Open Google Maps
          </a>
        </div>
      </section>

      <footer className="site-footer luxury-footer">
        <span><Building2 size={16} /> Jikmis Apartment</span>
        <span><Users size={16} /> Serviced apartments in Boudha</span>
      </footer>

      {isCafeMenuOpen && (
        <div className="cafe-modal-backdrop" role="presentation" onClick={() => setIsCafeMenuOpen(false)}>
          <div
            className="cafe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cafe-menu-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="cafe-modal-close"
              type="button"
              aria-label="Close Jikmis Café menu"
              onClick={() => setIsCafeMenuOpen(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow"><Coffee size={16} /> Open Daily</p>
            <h2 id="cafe-menu-title">Jikmis Café Menu</h2>
            <div className="cafe-menu-grid">
              {cafeMenu.map((group) => (
                <section className="cafe-menu-group" key={group.category}>
                  <h3>{group.category}</h3>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {isBookingModalOpen && (
        <div
          className="cafe-modal-backdrop booking-modal-backdrop"
          role="presentation"
          onClick={() => setIsBookingModalOpen(false)}
        >
          <div
            className="cafe-modal booking-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="cafe-modal-close booking-modal-close"
              type="button"
              aria-label="Close booking form"
              onClick={() => setIsBookingModalOpen(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow"><MessageCircle size={16} /> Check Availability</p>
            <h2 id="booking-modal-title">Book Jikmis Apartment</h2>
            <p>Fill in your stay details and contact info. We&apos;ll send this to our WhatsApp and to {INQUIRY_EMAIL} at the same time.</p>
            <form className="form-grid booking-modal-form" onSubmit={handleBookingSubmit}>
              <div className="form-grid-2">
                <label>
                  Room Type
                  <select
                    value={bookingForm.roomType}
                    onChange={(event) => setBookingForm((current) => ({ ...current, roomType: event.target.value }))}
                    required
                  >
                    {roomShowcase.map((room) => (
                      <option key={room.title} value={room.title}>
                        {room.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Guests
                  <input
                    type="number"
                    min="1"
                    placeholder="Add guests"
                    value={bookingForm.guests}
                    onChange={(event) => setBookingForm((current) => ({ ...current, guests: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Check in
                  <span className="date-field">
                    <Calendar size={16} className="date-field-icon" aria-hidden="true" />
                    <input
                      type="date"
                      min={todayIso}
                      value={bookingForm.checkIn}
                      onChange={(event) => {
                        const nextCheckIn = event.target.value;
                        setBookingForm((current) => ({
                          ...current,
                          checkIn: nextCheckIn,
                          checkOut: current.checkOut && current.checkOut <= nextCheckIn ? "" : current.checkOut
                        }));
                      }}
                      required
                    />
                  </span>
                </label>
                <label>
                  Check out
                  <span className="date-field">
                    <Calendar size={16} className="date-field-icon" aria-hidden="true" />
                    <input
                      type="date"
                      min={bookingForm.checkIn || todayIso}
                      value={bookingForm.checkOut}
                      onChange={(event) => setBookingForm((current) => ({ ...current, checkOut: event.target.value }))}
                      required
                    />
                  </span>
                </label>
              </div>
              {nightsPreview > 0 ? (
                <p className="nights-preview">
                  {nightsPreview} night{nightsPreview === 1 ? "" : "s"} total
                </p>
              ) : null}
              <label>
                Full Name
                <input
                  type="text"
                  placeholder="Your name"
                  value={contactDetails.name}
                  onChange={(event) => setContactDetails((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={contactDetails.email}
                  onChange={(event) => setContactDetails((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Phone Number
                <input
                  type="tel"
                  placeholder="+977..."
                  value={contactDetails.phone}
                  onChange={(event) => setContactDetails((current) => ({ ...current, phone: event.target.value }))}
                  required
                />
              </label>
              <button className="button primary" type="submit" disabled={bookingStatus === "sending"}>
                <Send size={18} /> {bookingStatus === "sending" ? "Booking..." : "Book Now"}
              </button>
              {bookingMessage ? (
                <p className={`message ${bookingStatus === "error" ? "error" : "success"}`} role="status">
                  {bookingMessage}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="lightbox-backdrop" role="presentation" onClick={() => setLightbox(null)}>
          <div
            className="lightbox-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${lightbox.title} photos`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="lightbox-header">
              <span>
                {lightbox.title} — {lightbox.index + 1} / {lightbox.images.length}
              </span>
              <button className="lightbox-close" type="button" aria-label="Close photo viewer" onClick={() => setLightbox(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="lightbox-stage">
              <button
                type="button"
                className="lightbox-nav lightbox-prev"
                aria-label="Previous photo"
                onClick={() =>
                  setLightbox((current) =>
                    current ? { ...current, index: (current.index - 1 + current.images.length) % current.images.length } : current
                  )
                }
              >
                <ChevronLeft size={22} />
              </button>
              <img src={lightbox.images[lightbox.index]} alt={`${lightbox.title} photo ${lightbox.index + 1}`} />
              <button
                type="button"
                className="lightbox-nav lightbox-next"
                aria-label="Next photo"
                onClick={() => setLightbox((current) => (current ? { ...current, index: (current.index + 1) % current.images.length } : current))}
              >
                <ChevronRight size={22} />
              </button>
            </div>
            <div className="lightbox-thumbs">
              {lightbox.images.map((image, index) => (
                <button
                  type="button"
                  key={image}
                  className={`lightbox-thumb ${index === lightbox.index ? "is-active" : ""}`}
                  onClick={() => setLightbox((current) => (current ? { ...current, index } : current))}
                  aria-label={`Go to photo ${index + 1}`}
                >
                  <img src={image} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isMobileMenuOpen ? (
        <nav className="mobile-more-sheet" aria-label="More site sections">
          <a href="#cafe" onClick={() => setIsMobileMenuOpen(false)}>Café</a>
          <a href="#tour" onClick={() => setIsMobileMenuOpen(false)}>Apartment Tour</a>
          <a href="#amenities" onClick={() => setIsMobileMenuOpen(false)}>Amenities</a>
          <a href="#nearby" onClick={() => setIsMobileMenuOpen(false)}>Nearby</a>
          <a href="#map" onClick={() => setIsMobileMenuOpen(false)}>Map</a>
          <button
            type="button"
            className="button primary mobile-nav-book"
            onClick={() => {
              setIsMobileMenuOpen(false);
              setIsBookingModalOpen(true);
            }}
          >
            <Send size={16} /> Book Now
          </button>
        </nav>
      ) : null}

      <nav className="mobile-tab-bar" aria-label="Mobile section navigation">
        <span
          className="mobile-tab-indicator"
          style={{ transform: `translateX(${mobileTabOrder.indexOf(activeMobileTabKey) * 100}%)` }}
          aria-hidden="true"
        />
        <a
          href="#about"
          className={`mobile-tab-item ${activeMobileTabKey === "about" ? "is-active" : ""}`}
          onClick={() => {
            setActiveMobileTab("about");
            setIsMobileMenuOpen(false);
          }}
        >
          <HomeIcon size={20} />
          <span>About</span>
        </a>
        <a
          href="#rooms"
          className={`mobile-tab-item ${activeMobileTabKey === "rooms" ? "is-active" : ""}`}
          onClick={() => {
            setActiveMobileTab("rooms");
            setIsMobileMenuOpen(false);
          }}
        >
          <BedDouble size={20} />
          <span>Rooms</span>
        </a>
        <button
          type="button"
          className="mobile-tab-item mobile-tab-chat-button"
          aria-label="Open chat"
          onClick={() => {
            setIsMobileMenuOpen(false);
            window.dispatchEvent(new Event("jikmis:open-chat"));
          }}
        >
          <span className="mobile-tab-chat-icon">
            <Bot size={20} />
          </span>
          <span>Chat</span>
        </button>
        <a
          href="#contact"
          className={`mobile-tab-item ${activeMobileTabKey === "contact" ? "is-active" : ""}`}
          onClick={() => {
            setActiveMobileTab("contact");
            setIsMobileMenuOpen(false);
          }}
        >
          <MessageCircle size={20} />
          <span>Contact</span>
        </a>
        <button
          type="button"
          className={`mobile-tab-item mobile-tab-menu-button ${isMobileMenuOpen ? "is-active" : ""}`}
          aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((open) => !open)}
        >
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          <span>Menu</span>
        </button>
      </nav>

      <ApartmentChatbot />
    </main>
  );
}
