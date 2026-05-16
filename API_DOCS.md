# CampusNexus Backend API Documentation

This document provides a perfectly detailed outline of all available endpoints on the Express backend. It is designed to be easily read by other AI models and developers to implement the frontend in any framework (Flutter, React, etc.).

## Base Configuration
- **Base URL:** `/api` (e.g., `http://localhost:3000/api` or production URL)
- **Content-Type:** `application/json`
- **Global Rate Limiting:** Unless specified otherwise, endpoints are subject to a global rate limit of **100 requests per 15 minutes** per IP.
  - *Exception:* The `/health` endpoint is exempt from rate limiting to facilitate dashboard monitoring.
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
*All Messaging endpoints share a strict rate limit of **120 requests per 1 minute** per IP.*

Messaging is now designed around the WhatsApp-style lifecycle used by the mobile app:
`queued/sending` is local-only, then the backend persists `sent`, receipts advance messages to `delivered`, `read`, or `played`.
Clients should create a local UUID/string `clientMessageId`, insert optimistically into Drift, POST to the backend, then reconcile with the returned server `id`.

### Message Object Contract
Returned messages include:
- `id` (UUID): Server message ID.
- `client_message_id` (String, Optional): Local optimistic/offline ID from the device.
- `chat_id`, `sender_id`.
- `body` (String, Nullable): Text/caption/sticker asset path. Nullable for media-only messages.
- `type`: `text`, `image`, `video`, `audio`, `document`, `sticker`, `poll`, `system`, `contact`, or `location`.
- `reply_to_id` (UUID, Nullable): Server message ID being replied to.
- `reply_to_client_message_id` (String, Nullable): Offline/local reply reference when server ID is not known yet.
- `message_status`: `queued`, `sending`, `sent`, `delivered`, `read`, or `failed`.
- `delivery_state`: aggregate server state for the chat.
- `edited_at`, `deleted_at`, `deleted_by`, `delete_scope`.
- `is_forwarded`, `forwarded_from_message_id`, `forward_count`.
- `mentions` (UUID Array): Users mentioned in the message.
- `sent_via_mesh` (Boolean): True when the message originated from offline mesh relay.
- `expires_at` (Timestamp, Nullable): Disappearing-message expiry.
- `metadata` (Object): Flexible client metadata.
- `chat_message_attachments[]`, `chat_message_reactions[]`, `chat_read_receipts[]`.
- `users`: sender display metadata.

### Chat Object Contract
Chats support direct, group, community, zone, and course conversations:
- `type`: `direct`, `group`, `community`, `zone`, or `course`.
- `community_id`: parent community for subgroup chats.
- `announcement_chat_id`: community-wide announcement channel for `community` chats.
- `is_announcement_channel`: true for the generated admin-only community broadcast group.
- `send_policy`: `all` or `admins`.
- `edit_info_policy`: `all` or `admins`.
- `pin_policy`: `all` or `admins`.
- `join_approval_required`, `invite_enabled`, `invite_code`.
- `community_member_visibility`: `subgroups` or `community_admins`.
- `community_join_policy`: `admins` or `open`.
- `max_subgroups`, `max_announcement_members`.
- `disappearing_seconds`, `retention_days`.
- `last_message_id`, `last_message_at`.
- Participant-specific settings are stored on `chat_participants`: `role`, `notification_level`, `muted_until`, `is_pinned`, `is_archived`, `last_read_at`.

### `GET /api/messages/events?token=<jwt>`
Opens a persistent Server-Sent Events stream for the current Express JWT auth path.
- **Access:** Private via query token.
- **Events:** `connected`, `message.created`, `message.edited`, `message.deleted`, `message.receipts.updated`, `message.reaction.updated`, `message.group.updated`, `message.participant.added`, etc.
- **Note:** Supabase Realtime publication is also enabled for messaging tables, but direct mobile subscriptions need auth alignment before replacing this backend-authenticated stream.

### `GET /api/messages/chats?limit=50&cursor=<iso>&type=group`
Lists the authenticated user's active chats with participant settings and unread count.
- **Access:** Private
- **Returns:** `{ status, results, nextCursor, data: [ { chat_id, role, notification_level, unread_count, chats: {...} } ] }`

### `POST /api/messages/direct`
Creates or returns an existing 1-on-1 chat.
- **Access:** Private
- **Body:** `{ "targetUserId": "uuid", "name?": "Display fallback", "avatarUrl?": "https://..." }`
- **Returns:** `{ status, data: { chatId, existing, chat? } }`

### `POST /api/messages/group`
Creates a group/community/zone/course chat.
- **Access:** Private
- **Body:**
  ```json
  {
    "name": "CS301 Study Group",
    "description": "Optional",
    "type": "group",
    "participantIds": ["uuid"],
    "sendPolicy": "all",
    "editInfoPolicy": "admins",
    "pinPolicy": "admins",
    "joinApprovalRequired": false,
    "inviteEnabled": true,
    "disappearingSeconds": null,
    "retentionDays": 30,
    "metadata": {}
  }
  ```
- **Returns:** `{ status, data: { ...chat, participants } }`

### WhatsApp-Style Communities
Communities are umbrella chats that contain one generated announcement channel and many linked subgroups.

#### `POST /api/messages/community`
Creates a community and an admin-only announcement channel.
- **Access:** Private
- **Body:**
  ```json
  {
    "name": "Faculty of Engineering",
    "description": "Faculty-wide updates and groups",
    "participantIds": ["uuid"],
    "communityMemberVisibility": "subgroups",
    "communityJoinPolicy": "admins",
    "maxSubgroups": 50,
    "maxAnnouncementMembers": 2000,
    "metadata": {}
  }
  ```
- **Returns:** `{ status, data: { community, announcementChat, participants } }`

#### `GET /api/messages/community/:communityId`
Returns the community, current user's community role, announcement channel, visible subgroups, and memberships.

#### `POST /api/messages/community/:communityId/groups`
Creates a subgroup inside the community. Only community owner/admin/moderator can create.
- **Body:** `{ "name": "CS301", "type": "group|zone|course", "participantIds": [], "sendPolicy": "all" }`

#### `POST /api/messages/community/:communityId/groups/:chatId`
Links an existing group/zone/course chat into the community. Requires admin rights in both the community and the target chat.

#### `DELETE /api/messages/community/:communityId/groups/:chatId`
Unlinks a subgroup from the community. Announcement channels cannot be unlinked through this endpoint.

### `GET /api/messages/:chatId?limit=50&before=<iso>&after=<iso>`
Retrieves paginated message history. Use `before` to load older messages.
- **Access:** Private participant only.
- **Returns:** `{ status, results, nextCursor, data: [ ...messagesAscending ] }`

### `POST /api/messages/:chatId`
Sends a message. The backend accepts all current app mock fields plus lifecycle/media fields.
- **Access:** Private participant only.
- **Body:**
  ```json
  {
    "id": "optional-client-id-or-server-uuid",
    "clientMessageId": "device-local-id",
    "body": "caption or text",
    "type": "image",
    "replyToId": "server-uuid-or-local-id",
    "replyToClientMessageId": "local-id",
    "attachmentUrl": "https://cdn.example/file.jpg",
    "attachmentName": "lecture.pdf",
    "attachmentSize": "2.4 MB",
    "audioDuration": "00:59",
    "attachments": [
      {
        "url": "https://cdn.example/file.jpg",
        "thumbnailUrl": "https://cdn.example/thumb.jpg",
        "fileHash": "sha256",
        "mimeType": "image/jpeg",
        "fileSize": 123456,
        "type": "image"
      }
    ],
    "mentions": ["uuid"],
    "isForwarded": false,
    "forwardCount": 0,
    "sentViaMesh": false,
    "metadata": {}
  }
  ```
- **Blocking behavior:** if the recipient has blocked the sender in a direct chat, the API still returns success to the sender, but the message is suppressed for the recipient and will not be delivered/read.
- **Returns:** `{ status, data: { ...message } }`

### `PATCH /api/messages/:chatId/receipts`
Marks messages as delivered, read, or played.
- **Access:** Private participant only.
- **Body:** `{ "status": "read", "messageIds": ["uuid"], "upToMessageId": "uuid" }`
- **Returns:** `{ status, data: { messageIds, receiptStatus } }`

### Message Actions
- `PATCH /api/messages/message/:messageId`: edit body/content/text. Stores edit history.
- `DELETE /api/messages/message/:messageId?scope=me|everyone`: delete for current user or everyone.
- `POST /api/messages/message/:messageId/reactions`: `{ "emoji": "🔥" }`.
- `DELETE /api/messages/message/:messageId/reactions`: remove current user's reaction.
- `POST /api/messages/message/:messageId/star`: star/bookmark.
- `DELETE /api/messages/message/:messageId/star`: unstar.

### Pins, Settings, Groups, Invites
- `POST /api/messages/:chatId/pins`: `{ "messageId": "uuid", "expiresAt?": "iso" }`. Max 3 active pins.
- `DELETE /api/messages/:chatId/pins/:messageId`: unpin.
- `PATCH /api/messages/:chatId/settings`: `{ "mutedUntil?", "notificationLevel": "all|mentions|urgent|none", "isPinned?", "isArchived?" }`.
- `PATCH /api/messages/:chatId/group`: update group controls, name, description, send policy, pin policy, join approval, retention.
- `POST /api/messages/:chatId/participants`: add participant or create join request.
- `PATCH /api/messages/:chatId/participants/:userId`: update role/status/settings.
- `DELETE /api/messages/:chatId/participants/:userId`: remove participant.
- `PATCH /api/messages/:chatId/join-requests/:userId`: approve/reject.
- `POST /api/messages/:chatId/invite/reset`: rotate invite code.
- `POST /api/messages/invite/:inviteCode/join`: join or request access by invite.

### Media Dedup / Upload Resume Metadata
- `POST /api/messages/media`: looks up by `fileHash`; if missing, registers upload metadata.
- `PATCH /api/messages/media/:mediaId`: updates `cdnUrl`, `thumbnailUrl`, `uploadStatus`, `uploadProgress`, `expiresAt`.
- **Note:** File bytes still upload through the app's CDN/storage pipeline. This endpoint stores hashes, thumbnails, and upload state for dedupe/resume.

### Blocks
- `GET /api/messages/blocks`: list users blocked by current user.
- `POST /api/messages/blocks`: `{ "blockedUserId": "uuid", "reason?": "spam" }`.
- `DELETE /api/messages/blocks/:blockedUserId`: unblock.

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
*All Admin endpoints require a valid JWT for a user whose `users.role` is one of the supported admin roles.*

The PRD admin backend now accepts the full admin role set:
`admin`, `super_admin`, `dept_admin`, `facilities`, `security`, `student_affairs`, `it_admin`.
Super-admin-only routes require `super_admin`.

### PRD Dashboard Endpoints

- `GET /api/admin/dashboard/stats`: command-centre health score, active counts, critical alerts, zone health grid, live feed.
- `GET /api/admin/reports`: paginated/filterable report list. Query: `status`, `category`, `zoneId`, `lifecycle`, `date`, `from`, `to`, `search`, `page`, `limit`.
- `GET /api/admin/reports/:id`: full report drawer payload with comments, lifecycle timeline, mentions, feedback, audit entries.
- `PATCH /api/admin/reports/:id/lifecycle`: `{ "status": "acknowledged|in_progress|resolved", "note?": "..." }`.
- `PATCH /api/admin/reports/:id/assign`: `{ "department": "facilities", "assigneeId?": "uuid", "note?": "..." }`.
- `POST /api/admin/reports/:id/comments`: official admin/staff comment. Body: `{ "body": "...", "isOfficial": true }`.
- `PATCH /api/admin/reports/:id/escalate`: escalates a report and records history/audit metadata.
- `PATCH /api/admin/reports/:id/duplicate`: `{ "duplicateOf": "report-uuid", "note?": "..." }`.
- `DELETE /api/admin/reports/:id`: delete report. Super admin only.
- `GET /api/admin/zones`: zones with computed health scores, status bands, active counts.
- `PATCH /api/admin/zones/:id/status`: override zone status. Body: `{ "status": "normal|watch|alert|critical|maintenance|closed", "reason?": "..." }`.
- `GET /api/admin/analytics?range=this_month`: chart-ready analytics payload.
- `GET /api/admin/sentiment`: derived mood score, tension index, trending concerns.
- `GET /api/admin/sentiment/history`: stored tension-index snapshots.
- `POST /api/admin/sentiment/snapshot`: captures the current mood/tension snapshot.
- `GET /api/admin/predictions`: derived maintenance predictions/risk matrix.
- `GET /api/admin/budget-evidence?zoneId=<uuid>&category=power`: TETFUND/budget evidence summary for a zone/category.
- `GET /api/admin/incidents`: critical incident log.
- `GET /api/admin/sos`: SOS history.
- `GET /api/admin/broadcasts`: broadcast/announcement history.
- `GET /api/admin/broadcasts/templates`: configured broadcast templates.
- `POST /api/admin/broadcasts`: official broadcast. Body: `{ "title": "...", "body": "...", "priority": "normal|urgent|critical", "category": "maintenance_notice", "targetZoneId?": "uuid", "scheduledFor?": "iso" }`.
- `POST /api/admin/broadcasts/process-scheduled`: sends due scheduled broadcasts. Use from Vercel Cron or a trusted admin job.
- `GET /api/admin/inbox?tab=unacknowledged|in_progress|resolved`: department-scoped inbox.
- `GET /api/admin/mentions`: department-scoped @mention feed.
- `GET /api/admin/escalations`: escalation history scoped to the admin role.
- `POST /api/admin/escalations/run`: runs the SLA escalation sweep. Use from Vercel Cron or a trusted admin job.
- `GET /api/admin/notifications`: notification bell feed.
- `PATCH /api/admin/notifications/:id/read`: marks one admin notification as read.
- `GET /api/admin/users`: user management. Super admin only.
- `POST /api/admin/users`: creates a staff/admin account. Super admin only. Requires `@unilorin.edu.ng` email and password.
- `PATCH /api/admin/users/:id`: update role/reliability/department/status. Super admin only.
- `POST /api/admin/users/:id/reliability-adjustments`: updates reliability score with a required reason and durable adjustment log.
- `GET /api/admin/settings`: SLA, department, notification config. Super admin only.
- `PATCH /api/admin/settings`: update admin settings. Super admin only.
- `GET /api/admin/audit`: non-deletable admin action log. Super admin only.
- `GET /api/admin/events?token=<jwt>` or `/api/admin/realtime?token=<jwt>`: SSE realtime admin events.

### Report Fields Added For Admin

Reports now support `exact_lat`, `exact_lng`, `specific_location`, `building_id`, `lifecycle_status`, acknowledge/in-progress/resolution timestamps, assignment fields, escalation level, duplicate linkage, and audit/history metadata.

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
 
 ---
 
 ## 9. System (`/health`)
 
 ### `GET /health`
 Provides a detailed status report of the backend system.
 - **Access:** Public
 - **Rate Limiting:** **Exempt** (Unlimited polling allowed)
 - **Returns:**
   ```json
   {
     "status": "UP",
     "uptime": 123.456,
     "timestamp": "2026-04-29T12:18:54.123Z",
     "database": "CONNECTED",
     "system": {
       "node_version": "v22.12.0",
       "memory_usage": "48MB",
       "platform": "win32"
     },
     "cache": true
   }
   ```
   - **database**: Can be `CONNECTED`, `DEGRADED` (API up, DB down), or `ERROR`.
   - **cache**: Indicates if the database check was served from the 30-second internal cache.
