# furni-platform-backend (FastAPI)

參考文件：`doc/furniture_platform_domain_design_v1.md`

## 1) 安裝

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2) 啟動

```bash
uvicorn app.main:app --reload
```

啟動後：

- API: http://127.0.0.1:8000
- Swagger: http://127.0.0.1:8000/docs

## 3) API

- `GET /health`
- `GET /api/v1/feed?cursor=0&limit=20`
- `GET /api/v1/products/{product_id}`
- `GET /api/v1/products/{product_id}/drawer`
- `POST /api/v1/wishlist/items`
- `POST /api/v1/viewlist/items`
- `POST /api/v1/collections`
- `POST /api/v1/collections/{collection_id}/items`
- `GET /api/v1/users/{user_id}/wishlist`
- `GET /api/v1/users/{user_id}/viewlist`
- `GET /api/v1/collections`
- `GET /api/v1/collections/{id}/items`
- `DELETE /api/v1/collections/{id}/items/{item_id}`
- `GET /api/v1/wishlists/default?user_id=...`
- `POST /api/v1/wishlists/default/items`
- `DELETE /api/v1/wishlists/default/items/{id}?user_id=...`
- `GET /api/v1/viewlists/default?user_id=...`
- `POST /api/v1/viewlists/default/items`
- `DELETE /api/v1/viewlists/default/items/{id}?user_id=...`
- `GET /api/v1/auth/line/start`
- `GET /api/v1/auth/line/callback`
- `GET /api/v1/auth/google/start`
- `GET /api/v1/auth/google/callback`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`

## 4) OAuth

目前支援 LINE Login 與 Google Login。

請直接在執行環境設定系統環境變數：

```bash
LINE_CLIENT_ID=...
LINE_CLIENT_SECRET=...
LINE_REDIRECT_URI=http://127.0.0.1:8000/api/v1/auth/line/callback

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:8000/api/v1/auth/google/callback
```

LINE Developers Console 對應欄位：

- `LINE_CLIENT_ID`: `Channel ID`
- `LINE_CLIENT_SECRET`: `Channel secret`
- `LINE_REDIRECT_URI`: `Callback URL`

Google Cloud Console 對應欄位：

- `GOOGLE_CLIENT_ID`: OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: OAuth Client Secret
- `GOOGLE_REDIRECT_URI`: Authorized redirect URI

前端登入入口：

- `/api/v1/auth/line/start`
- `/api/v1/auth/google/start`

OAuth 成功後，後端會建立本地 session，並把 token 帶回首頁 URL hash，前端再寫入 `localStorage`。

## 5) 本地測試 with ngrok

LINE Login 或 Google Login 在本機測試時，`Callback URL` 不能用 `127.0.0.1`，要改成 ngrok 提供的公開 `https` 網址。

1. 到 ngrok dashboard 取得 `authtoken`
2. 在本機執行：

```bash
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

3. 啟動後端：

```bash
start_server.bat
```

4. 啟動 tunnel：

```bash
start_ngrok.bat
```

5. 取得 ngrok 公開網址，例如：

```text
https://abc123.ngrok-free.app
```

6. 同步更新這兩邊：

- Provider Console 的 callback / redirect URL
- 伺服器環境變數內對應的 redirect URI

範例：

```env
LINE_REDIRECT_URI=https://abc123.ngrok-free.app/api/v1/auth/line/callback
GOOGLE_REDIRECT_URI=https://abc123.ngrok-free.app/api/v1/auth/google/callback
```

## 6) 資料庫

- 使用 SQLite (`furni.db`)
- 啟動時會建立 schema migration 與 seed data

## 7) 前端串接

```js
const res = await fetch(`/api/v1/feed?cursor=${cursor}&limit=${limit}`)
const data = await res.json()
appendFeed(data.items)
cursor = data.next_cursor ?? cursor
```

商品詳情：

```js
GET /api/v1/products/{id}
```

加入清單：

```js
POST /api/v1/wishlist/items
POST /api/v1/viewlist/items
```
