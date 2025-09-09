# Zalo API Express Starter (zca-js)

A minimal Express.js structure prepped to integrate with `zca-js` for Zalo OA/API work.

## Structure

- `src/index.js` – server bootstrap
- `src/app.js` – express app, middleware, and routes
- `src/config/index.js` – environment configuration via dotenv
- `src/routes/` – route definitions
- `src/controllers/` – request handlers
- `src/services/zalo.service.js` – thin wrapper around `zca-js`
- `src/middlewares/errorHandler.js` – 404 and error handler
- `src/db/`, `src/repositories/` – PostgreSQL persistence (sessions, users)

## Setup

1. Copy environment file and fill your credentials:

```bash
cp .env.example .env
# edit .env
```

2. Install dependencies:

```bash
npm install
# If not previously installed:
# npm install express cors morgan dotenv zca-js pg
# npm install -D nodemon
```

3. Run in dev mode:

```bash
npm run dev
```

Server starts at `http://localhost:3000` by default.

## Notes on `zca-js`

- The service wrapper at `src/services/zalo.service.js` logs in using cookie-based session via `Zalo().loginCookie(...)` and keeps an API instance cached.
- You must provide a valid session (cookies, imei, userAgent). See the Session API below.

## PostgreSQL

Set PG connection in `.env` (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSL`).

On server start, a simple migration runs to create:

- `sessions`: store the active Zalo session (cookies_json, imei, user_agent, language).
- `users`: map `external_user_id` ↔ `zalo_uid` and cache `profile_json`.

Requires the extension `pgcrypto` (auto-created in migration) for `gen_random_uuid()`.

## API Endpoints

### Health

- GET `/health`

### Session (Zalo login state)

- POST `/api/session`

Body:

```json
{
  "cookies_json": [ /* cookie array/object from zca-js loginQR result */ ],
  "imei": "string",
  "user_agent": "string",
  "language": "vi",
  "account_id": "optional"
}
```

Purpose: Sets the active Zalo session used by the backend to call `zca-js` APIs.

### Users

- POST `/api/users/map`

Body:

```json
{
  "external_user_id": "your-system-user-id",
  "zalo_uid": "zalo-user-id"
}
```

Maps your external ID to Zalo UID.

- GET `/api/users/:external_user_id?refresh=true|false`

Returns user profile data. Flow:

1. Look up mapping by `external_user_id`.
2. If cached `profile_json` exists and `refresh` is not true, return cache.
3. Else call `zca-js` `getUserInfo(zalo_uid)`, extract profile and update cache.

Response:

```json
{
  "ok": true,
  "data": { /* profile fields */ }
}
```

## Typical Flow to Integrate with Another Backend

1) Obtain Zalo session cookies via `loginQR` using `zca-js` (can be a separate script/process). Save cookies, imei, userAgent.
2) Call `POST /api/session` with those values.
3) Map your system user to Zalo user: `POST /api/users/map` with `external_user_id` and `zalo_uid`.
4) From other services, call `GET /api/users/:external_user_id` to fetch profile (cached with optional refresh).

## Next Steps

- Implement webhook signature verification using your Zalo secret key.
- Map real `zca-js` methods in `zalo.service.js` (send messages, get user profiles, etc.).
- Add more routes/controllers as your features grow.

# Tài liệu bằng Tiếng Việt

## Tổng quan

Backend Express.js đã được tích hợp sẵn với thư viện không chính thức `zca-js` (Zalo API cho JavaScript) và lớp lưu trữ PostgreSQL. Mục tiêu: từ một hệ thống khác, bạn chỉ cần truyền `external_user_id` để backend trả về dữ liệu người dùng Zalo tương ứng (thông qua ánh xạ `external_user_id` ↔ `zalo_uid` và cache hồ sơ).

## Cấu trúc thư mục

- `src/index.js` – khởi động server, chạy migrate Postgres trước khi lắng nghe HTTP.
- `src/app.js` – cấu hình Express, middleware, mount routes.
- `src/config/index.js` – nạp biến môi trường bằng dotenv.
- `src/routes/` – định nghĩa route.
- `src/controllers/` – xử lý request.
- `src/services/zalo.service.js` – service tích hợp `zca-js`, đăng nhập bằng cookie và cung cấp `getUserInfo`, `sendMessage`.
- `src/middlewares/errorHandler.js` – 404 và error handler.
- `src/db/`, `src/repositories/` – lớp truy cập Postgres (bảng `sessions`, `users`).

## Thiết lập

1) Tạo file môi trường và điền thông tin:

```bash
cp .env.example .env
# Sau đó mở .env và cấu hình các biến
```

2) Cài đặt phụ thuộc:

```bash
npm install
# Nếu thiếu thì cài cụ thể:
# npm install express cors morgan dotenv zca-js pg
# npm install -D nodemon
```

3) Chạy chế độ phát triển:

```bash
npm run dev
```

Server lắng nghe tại `http://localhost:3000` (mặc định PORT=3000).

## PostgreSQL

Khai báo kết nối trong `.env`:

- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSL`

Khi khởi động, hệ thống sẽ chạy migrate để tạo:

- Bảng `sessions`: lưu phiên Zalo (cookies_json, imei, user_agent, language).
- Bảng `users`: ánh xạ `external_user_id` ↔ `zalo_uid` và cache `profile_json`.

Yêu cầu extension `pgcrypto` để dùng `gen_random_uuid()` (được tạo tự động trong migrate; cần quyền phù hợp trên DB).

## Tích hợp zca-js (đăng nhập bằng cookie)

- `src/services/zalo.service.js` tạo `new Zalo()` và gọi `loginCookie({ cookie, imei, userAgent, language })` từ session đang active trong DB.
- Sau khi đăng nhập thành công, service giữ API instance và tái sử dụng trong một khoảng thời gian để tối ưu hiệu năng.
- Cần cung cấp `cookies_json`, `imei`, `user_agent` hợp lệ. Cookie thường lấy được từ flow `loginQR` của `zca-js`.

## API Endpoints

### Kiểm tra hệ thống

- `GET /health`: trả về trạng thái OK, thời gian uptime.

### Quản lý phiên Zalo (Session)

- `POST /api/session`

Body mẫu:

```json
{
  "cookies_json": [ /* mảng cookie từ kết quả loginQR */ ],
  "imei": "chuoi-imei",
  "user_agent": "UA-cua-ban",
  "language": "vi",
  "account_id": "tuy-chon"
}
```

Mục đích: Thiết lập phiên Zalo đang active để backend dùng gọi các API của `zca-js`.

### Người dùng

- `POST /api/users/map`

Body:

```json
{
  "external_user_id": "ma-nguoi-dung-ben-he-thong-khac",
  "zalo_uid": "ma-nguoi-dung-tren-zalo"
}
```

Tác dụng: ánh xạ `external_user_id` của hệ thống khác với `zalo_uid`.

- `GET /api/users/:external_user_id?refresh=true|false`

Luồng xử lý:

1. Tra `external_user_id` trong DB để tìm `zalo_uid`.
2. Nếu đã có `profile_json` cache và không yêu cầu `refresh`, trả về cache ngay.
3. Nếu cần làm mới, gọi `zca-js` `getUserInfo(zalo_uid)`, trích profile và cập nhật cache rồi trả về.

## Quy trình tích hợp với hệ thống khác

1) Lấy cookie phiên Zalo bằng `loginQR` (ở script/tool riêng). Lưu lại `cookies_json`, `imei`, `user_agent`.
2) Gọi `POST /api/session` để thiết lập phiên active cho backend.
3) Map người dùng: `POST /api/users/map` với `external_user_id` và `zalo_uid` tương ứng.
4) Ở các dịch vụ khác, chỉ cần gọi `GET /api/users/:external_user_id` để lấy hồ sơ người dùng (có cache, có thể `refresh`).

## Ghi chú bảo mật

- `cookies_json` là thông tin nhạy cảm. Đảm bảo DB an toàn, hạn chế quyền truy cập, mã hóa ở mức hạ tầng (at-rest, in-transit) nếu có thể.
- Cân nhắc log cẩn thận, tránh in cookie ra console/log.

## Hướng phát triển tiếp theo

- Xác thực chữ ký webhook nếu dùng webhook của Zalo.
- Bổ sung thêm phương thức `zca-js` (gửi tin nhắn, lắng nghe sự kiện, v.v.) theo nhu cầu.
- Mở rộng schema/DB nếu cần lưu lịch sử hội thoại, idempotency của webhook, thống kê.
Dưới đây là phương án tối ưu để “nghe tin nhắn” cho nhiều tài khoản Zalo (đa phiên) bằng thư viện zca-js, tuân thủ ràng buộc “mỗi account chỉ được chạy 1 listener tại một thời điểm”.

Mục tiêu

Nghe tin nhắn real-time cho nhiều người dùng đã đăng nhập (nhiều session) trong zaloapi.
Không vi phạm ràng buộc “Only one web listener can run per account at a time”.
Tự động khôi phục listener sau khi server restart.
Đảm bảo an toàn (tránh chạy 2 listener cho cùng account), bền bỉ (tự khởi động lại khi cookie hết hạn).
Đồng bộ tin nhắn về backend dangbai qua HTTP/WS, và lưu DB.
Kiến trúc đề xuất

Lưu trữ phiên
Bảng sessions (đã có):
session_key = user_id từ dangbai
account_id (zalo uid)
cookies_json (JSONB, payload dạng { cookie: "" })
imei, user_agent, language, is_active, updated_at
Bảng messages (đề xuất thêm):
id (uuid), session_key, account_id, thread_type (user/group), peer_id, direction (in/out), content, attachments_json, message_id, created_at
Mapping: session_key <-> dangbai user, để route message đúng user.
Listener Manager (đa phiên)
Tạo src/services/listenerManager.js trong zaloapi:
Startup:
Query tất cả sessions đang is_active = true.
For mỗi session: tạo 1 “worker” (instance) đăng nhập bằng loginCookie rồi đăng ký api.listener.on("message", ...) và 
api.listener.start()
.
Bảo vệ đồng thời:
Dùng Redis lock hoặc “process-wide lock” + “db advisory lock” để đảm bảo mỗi account_id chỉ có 1 listener đang chạy.
Ví dụ key lock: zalo:listener:account:{account_id}
Tự phục hồi:
Nếu listener stop do người dùng mở Zalo Web/App (theo cảnh báo), phát hiện close/stop event và backoff khởi động lại sau n giây.
Nếu cookie hết hạn, phát SSE hoặc log cảnh báo; có thể yêu cầu người dùng re-login.
Xử lý message
Trong api.listener.on("message"):
Phân loại 
ThreadType.User
 và ThreadType.Group.
Chỉ nhận text: typeof message.data.content === "string".
Lưu DB bảng messages.
Đẩy về dangbai:
HTTP nội bộ: POST http://localhost:8000/api/v1/zalo/messages/incoming với payload gồm session_key, account_id, thread_type, peer_id, content, message_id, timestamp…
Hoặc phát qua WebSocket từ dangbai cho UI realtime.
Chống trùng lặp: lưu message_id + unique index, bỏ qua nếu đã có.
Endpoint quản trị
GET /api/auth/session/:key (đã có) để kiểm tra trạng thái.
POST /api/listeners/start/:key khởi động listener cho 1 session cụ thể (khi bạn muốn on-demand).
POST /api/listeners/stop/:key dừng listener (khi người dùng logout).
GET /api/listeners liệt kê tình trạng tất cả listener (đang chạy/dừng).
Quản lý ràng buộc “một listener/acc”
Khi listenerManager khởi động listener cho account_id:
Acquire lock (Redis SET NX EX, hoặc DB advisory lock).
Nếu lock thất bại, nghĩa là đã có process khác giữ, không khởi động lần nữa.
Trước khi start 
api.listener.start()
, kiểm tra nếu đã có activeListeners[account_id] trong process thì bỏ qua.
Mẫu triển khai (rút gọn)
File: zaloapi/src/services/listenerManager.js

js
import { Zalo, ThreadType } from 'zca-js';
import * as sessionRepo from '../repositories/session.repository.js';
import { saveIncomingMessage } from '../repositories/message.repository.js';
import { postToDangbai } from '../utils/dangbaiClient.js';
import { acquireLock, releaseLock } from '../utils/lock.js';

const activeListeners = new Map(); // account_id -> { api, stop, session_key }

export async function startAllListeners() {
  const sessions = await loadActiveSessions(); // select * from sessions where is_active=true
  for (const s of sessions) {
    try { await startListenerForSession(s); } catch (e) { console.error('[Listener] start failed', s.session_key, e); }
  }
}

export async function startListenerForSession(sessionRow) {
  const { session_key, account_id, cookies_json, imei, user_agent, language } = sessionRow;
  if (!cookies_json) throw new Error('Missing cookies_json');

  // Lock theo account_id để tránh trùng listener
  const lockKey = `zalo:listener:account:${account_id || session_key}`;
  const locked = await acquireLock(lockKey, 30); // 30s ttl
  if (!locked) {
    console.log('[Listener] Lock busy, skip', account_id || session_key);
    return;
  }

  if (activeListeners.has(account_id)) {
    await releaseLock(lockKey);
    console.log('[Listener] Already running', account_id);
    return;
  }

  const cookies = typeof cookies_json === 'string' ? JSON.parse(cookies_json).cookie : (cookies_json.cookie || cookies_json);
  const zalo = new Zalo();
  const api = await zalo.loginCookie({ cookie: cookies, imei, userAgent: user_agent, language: language || 'vi' });

  api.listener.on('message', async (message) => {
    try {
      const isText = typeof message?.data?.content === 'string';
      if (!isText) return;

      const threadType = message.type; // ThreadType.User / ThreadType.Group
      const peerId = message?.data?.senderId || message?.data?.groupId || null;
      const content = message.data.content;
      const msgId = message?.data?.messageId;

      // Lưu DB
      await saveIncomingMessage({
        session_key,
        account_id,
        thread_type: threadType,
        peer_id: String(peerId || ''),
        content,
        message_id: String(msgId || ''),
        attachments_json: message?.data?.attachments || null
      });

      // Đẩy về dangbai
      await postToDangbai('/api/v1/zalo/messages/incoming', {
        session_key, account_id, thread_type: threadType, peer_id, content, message_id: msgId
      });
    } catch (err) {
      console.error('[Listener] handle message error', err);
    }
  });

  api.listener.on('stop', async () => {
    console.warn('[Listener] stopped', account_id);
    activeListeners.delete(account_id);
    await releaseLock(lockKey);
    // backoff khởi động lại sau vài giây nếu cần
    setTimeout(() => startListenerForSession(sessionRow).catch(console.error), 5000);
  });

  api.listener.start();
  activeListeners.set(account_id, { api, stop: () => api.listener.stop(), session_key });
  console.log('[Listener] started', account_id);
}
Gợi ý tiện ích:

utils/lock.js: Redis-based lock (SET NX EX) để chạy đa process an toàn.
repositories/message.repository.js: insert message với unique index (session_key, message_id) để tránh trùng.
utils/dangbaiClient.js: HTTP client base URL tới dangbai.
Luồng hoạt động tổng thể
User A…N đăng nhập Zalo qua QR -> lưu vào sessions.
Khi zaloapi khởi động:
startAllListeners() đọc danh sách session, tạo listener cho từng tài khoản.
Mỗi listener nhận message và lưu DB + đẩy sang dangbai.
Nếu người dùng mở Zalo web/app, listener sẽ bị stop; manager phát hiện và auto-start lại (backoff).
Nếu cookie hết hạn, manager log cảnh báo và có thể gửi notification, yêu cầu re-login.
Tích hợp với dangbai
Endpoint mới trong dangbai: POST /api/v1/zalo/messages/incoming lưu message theo user_id = session_key, phát WS tới UI.
Màn hình UI có thể hiển thị trạng thái connected (dựa trên /api/v1/zalo/status đã sửa) và danh sách tin nhắn.
Lưu ý vận hành
Hạn chế số listener đồng thời (tối đa theo CPU/RAM).
Giới hạn tốc độ API outbound tới Zalo (nếu polling).
Log gắn session_key để dễ debug.
Mã hoá cookies_json nếu cần (bảo mật).
Kết luận

Với zca-js, bạn có thể nghe tin nhắn đa tài khoản bằng mô hình “listener manager”: mỗi session 1 listener, có lock theo account_id để đảm bảo “1 listener/account”.
Giải pháp an toàn, bền bỉ, tự khôi phục, và dễ mở rộng. Nếu bạn muốn, tôi có thể:
Tạo skeleton listenerManager.js, message.repository.js, dangbaiClient.js, route nhận message trong dangbai.
Thêm Redis lock (hoặc dùng Postgres advisory lock) ngay trong code hiện tại.