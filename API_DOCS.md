# CampusNexus Backend API Documentation

This document provides a perfectly detailed outline of all available endpoints on the Express backend. It is designed to be easily read by other AI models and developers to implement the frontend in any framework (Flutter, React, etc.).

## Base Configuration
- **Base URL:** `/api` (e.g., `http://localhost:3000/api` or production URL)
- **Content-Type:** `application/json`
- **Global Rate Limiting:** Unless specified otherwise, endpoints are subject to a global rate limit of **100 requests per 15 minutes** per IP.
- **Authentication:** Endpoints marked as **Private** require an `Authorization` header containing a valid JWT.
  - Format: `Authorization: Bearer <jwt_token>`

---

## 1. Authentication (`/api/auth`)
*All Auth endpoints share a strict rate limit of **10 requests per hour** per IP to prevent brute forcing.*

### `POST /api/auth/register`
Creates a new user account.
- **Access:** Public
- **Body Payload (JSON):**
  - `email` (String, **Required**): Must be a valid email format. Custom validation enforces that it MUST end with `.edu.ng`.
  - `password` (String, **Required**): Must be at least 8 characters long.
- **Returns:** `{ status: 'success', data: { user, token } }`

### `POST /api/auth/login`
Authenticates an existing user and returns a session token.
- **Access:** Public
- **Body Payload (JSON):**
  - `email` (String, **Required**): Valid email address.
  - `password` (String, **Required**): User's password.
- **Returns:** `{ status: 'success', data: { user, token } }`

### `POST /api/auth/google`
Authenticates via Google OAuth token.
- **Access:** Public
- **Body Payload (JSON):**
  - `id_token` or `idToken` (String, **Required**): The JWT credential obtained from Google Identity Services.
- **Returns:** `{ status: 'success', data: { user, token } }`

---

## 2. Users (`/api/users`)

### `PUT /api/users/edit`
Updates the authenticated user's profile information.
- **Access:** Private
- **Body Payload (JSON):**
  - `display_name` (String, **Required**): Must be between 2 and 20 characters. Automatically escaped to prevent XSS.
- **Returns:** `{ status: 'success', data: { ...updatedUser } }`

---

## 3. Configuration (`/api/config`)

### `GET /api/config`
Retrieves public system configuration (e.g., global map boundaries, active semesters).
- **Access:** Public
- **Parameters:** None
- **Returns:** JSON object containing safe-to-expose configuration constants.

---

## 4. Reports (`/api/reports`)

### `GET /api/reports`
Fetches a list of campus reports, sorted by creation date (newest first).
- **Access:** Public
- **Query Parameters (URL):**
  - `zoneId` (UUID String, *Optional*): Filter reports by a specific zone.
  - `category` (String, *Optional*): Filter by category (e.g., 'security', 'infrastructure').
  - `status` (String, *Optional*): Filter by report status ('pending', 'community', 'verified', 'critical', 'resolved').
- **Returns:** `{ status: 'success', results: Int, data: [ ...reports ] }`
  - *Note:* The returned data joins the `users` table to provide `display_name` and `avatar_url` of the submitter (if not anonymous).

### `POST /api/reports`
Submits a new report. Automatically calculates `final_trust_score` and `status` on the backend.
- **Access:** Private
- **Rate Limiting:** Strict **20 requests per 15 minutes** per IP.
- **Body Payload (JSON):**
  - `zoneId` (UUID String, **Required**): ID of the zone where the incident occurred.
  - `category` (String, **Required**): Selected category.
  - `title` (String, **Required**): Max 100 characters.
  - `description` (String, *Optional*): Max 1000 characters.
  - `photoUrl` (URL String, *Optional*): Direct link to uploaded image in cloud storage.
  - `isAnonymous` (Boolean, *Optional*): Defaults to `false`. If `true`, the `user_id` will be scrubbed from the final database insertion to ensure privacy.
  - `confidenceScore` (Float, *Optional*): Client-side generated confidence score (0-10). Defaults to 3.0.
  - `id` (UUID String, *Optional*): Client-side generated UUID for optimistic UI. If omitted, DB generates one.
- **Returns:** `{ status: 'success', data: { ...newReport } }`

---

## 5. Messaging (`/api/messages`)
*All Messaging endpoints share a strict rate limit of **60 requests per 1 minute** per IP.*

### `GET /api/messages/chats`
Retrieves a list of all active chats (both Direct and Group) the authenticated user is a participant of.
- **Access:** Private
- **Returns:** `{ status: 'success', data: [ { chat_id, joined_at, chats: { id, type, name, ... } } ] }`

### `POST /api/messages/direct`
Initiates a new 1-on-1 direct message chat. If a direct chat already exists between the two users, it safely returns the existing `chatId` instead of duplicating.
- **Access:** Private
- **Body Payload (JSON):**
  - `targetUserId` (UUID String, **Required**): ID of the user to chat with. Cannot be your own user ID.
- **Returns:** `{ status: 'success', data: { chatId: "uuid" } }`

### `POST /api/messages/group`
Creates a new group chat and automatically adds the creator as 'admin'.
- **Access:** Private
- **Body Payload (JSON):**
  - `name` (String, **Required**): Name of the group (Max 50 characters).
  - `participantIds` (Array of UUID Strings, **Required**): IDs of the users to add to the group. The creator's ID is automatically handled and does not need to be in this array (but is safely ignored if included).
- **Returns:** `{ status: 'success', data: { ...newChat } }`

### `GET /api/messages/:chatId`
Retrieves the most recent message history for a specific chat. Max 100 messages returned per call.
- **Access:** Private
- **Path Parameters:**
  - `chatId` (UUID String, **Required**): Extracted from the URL path.
- **Returns:** `{ status: 'success', data: [ { id, sender_id, body, created_at, users: { display_name, avatar_url } } ] }`

### `POST /api/messages/:chatId`
Sends a text message to a specific chat.
- **Access:** Private
- **Path Parameters:**
  - `chatId` (UUID String, **Required**): Extracted from the URL path.
- **Body Payload (JSON):**
  - `body` (String, **Required**): The message content (Max 2000 characters). Automatically trimmed and escaped.
- **Returns:** `{ status: 'success', data: { ...newMessage } }`
- *Note:* Protected by Supabase Row Level Security. Returns HTTP `403 Forbidden` if the user attempts to send a message to a chat they are not a participant in.

---

## 6. AI Tools (`/api/ai`)
*Endpoints that interact with Google Gemini AI. Currently unprotected to allow client flexibility, but should be token-gated in production.*

### `POST /api/ai/analyze`
Passes report parameters to Gemini to generate scoring metrics (credibility, sentiment) and auto-assign tags.
- **Access:** Public (Currently)
- **Body Payload (JSON):**
  - `title` (String, *Optional*)
  - `description` (String, *Optional*)
  - `category` (String, *Optional*)
  - `zoneName` (String, *Optional*)
  - `corroborations` (Integer, *Optional*)
  - `disputes` (Integer, *Optional*)
- **Returns:**
  ```json
  {
    "status": "success",
    "data": {
      "sentiment_score": 7.2,
      "credibility_score": 6.5,
      "ai_score": 6.8,
      "summary": "...",
      "category": "...",
      "flags": ["urgent"]
    }
  }
  ```

### `POST /api/ai/chat`
Allows a natural language query against active campus reports and zones.
- **Access:** Public
- **Body Payload (JSON):**
  - `userQuery` (String, **Required**): The question being asked.
  - `activeReports` (Array of Objects, *Optional*): Context array of current reports.
  - `zones` (Array of Objects, *Optional*): Context array of campus zones.
- **Returns:** `{ status: 'success', data: "String response from Gemini" }`

---

## 7. Admin (`/api/admin`)
*All Admin endpoints require a valid JWT for a user whose `users.role` is `admin`.*

### `GET /api/admin/users`
Lists users for role management.
- **Access:** Private, Admin
- **Returns:** `{ status: 'success', results: Int, data: [ ...users ] }`

### `PATCH /api/admin/users/:userId/role`
Assigns a role to a user.
- **Access:** Private, Admin
- **Body Payload (JSON):**
  - `role` (String, **Required**): One of `student`, `staff`, `security`, `admin`.
- **Returns:** `{ status: 'success', data: { ...updatedUser } }`

### `PATCH /api/admin/reports/:reportId/status`
Updates a report status from the admin panel.
- **Access:** Private, Admin
- **Body Payload (JSON):**
  - `status` (String, **Required**): One of `pending`, `community`, `verified`, `critical`, `resolved`.
- **Returns:** `{ status: 'success', data: { ...updatedReport } }`

### `GET /api/admin/events?token=<jwt_token>`
Opens a Server-Sent Events stream for realtime admin notifications. The token is passed as a query parameter because browser `EventSource` cannot send custom authorization headers.
- **Access:** Private, Admin
- **Events:** `connected`, `report.created`, `report.updated`, `announcement.created`, `user.role_updated`

---

## 8. Announcements (`/api/announcements`)

### `GET /api/announcements`
Fetches active announcements newest first.
- **Access:** Public through backend API
- **Returns:** `{ status: 'success', results: Int, data: [ ...announcements ] }`

### `GET /api/announcements/events?token=<jwt_token>`
Opens a Server-Sent Events stream for signed-in users. It only emits `announcement.created` events where `audience_role` is `all` or matches the user's role.
- **Access:** Private
- **Events:** `connected`, `announcement.created`

### `POST /api/announcements`
Creates an announcement and broadcasts it to the admin realtime stream.
- **Access:** Private, Admin
- **Body Payload (JSON):**
  - `title` (String, **Required**): Max 120 characters.
  - `body` (String, **Required**): Max 2000 characters.
  - `priority` (String, *Optional*): `normal`, `important`, or `urgent`.
  - `audienceRole` (String, *Optional*): `all`, `student`, `staff`, `security`, or `admin`.
  - `expiresAt` (ISO8601 String, *Optional*): Optional expiry timestamp.
- **Returns:** `{ status: 'success', data: { ...announcement } }`
