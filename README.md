# Jikmis Apartment AI Chatbot Website

Full-stack apartment inquiry website for **Jikmis Apartment, Boudha, Kathmandu** with a 24/7 AI receptionist chatbot.

## Project Structure

```txt
app/                         Next.js frontend pages
app/page.tsx                 Single-page apartment website
components/ApartmentChatbot.tsx
server/src/index.js          Express API entrypoint
server/src/routes/chatRoutes.js
server/src/middleware        Shared Express middleware
```

## Frontend

The homepage includes:

- Hero section for Jikmis Apartment
- About, rooms, facilities, pricing, location, and contact sections
- Floating AI receptionist in the bottom-right corner
- Message bubbles, quick replies, typing indicator, and scrollable chat history
- WhatsApp, call, and email buttons

## Backend Chat API

The Express backend includes:

- `POST /chat`
- CORS
- JSON parsing middleware
- OpenAI API integration
- Central error handling

Example request:

```json
{
  "message": "What is the monthly price?"
}
```

Example response:

```json
{
  "reply": "Monthly stays are NPR 37,000-65,000. Please contact us on WhatsApp or call +9779708538395 to check availability."
}
```

The AI receptionist answers only from the Jikmis Apartment information in `server/src/routes/chatRoutes.js` and redirects unrelated questions back to room inquiries.

## Setup

Install dependencies:

```bash
npm install
```

Copy environment variables:

```bash
cp .env.example .env
```

Configure `.env`:

```txt
PORT=4000
HOST="127.0.0.1"
CLIENT_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:4000"
OPENAI_API_KEY="your-openai-api-key"
OPENAI_MODEL="gpt-4o-mini"
```

Start the backend API:

```bash
npm run dev:api
```

Start the Next.js frontend in another terminal:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Contact Details

- WhatsApp: `+9779708538395`
- Call: `+9779708538395`
- Email: `jikmisdonkhang@gmail.com`
- Location: Boudha, Kathmandu near Boudha Stupa

## Deploy Notes

- Deploy the frontend to Vercel.
- Deploy the Express API on Render or another Node.js host.
- Set `CLIENT_URL` to the deployed frontend URL.
- Set `NEXT_PUBLIC_API_URL` to the deployed backend URL.
- Keep `OPENAI_API_KEY` only on the backend host.

## Existing Legacy Modules

This repository also contains earlier booking/admin modules, Prisma schema, and routes for rooms, auth, bookings, and admin. The main homepage now focuses on inquiry and AI receptionist behavior, not a booking checkout flow.
