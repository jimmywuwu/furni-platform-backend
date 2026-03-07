# furni-platform-backend (FastAPI)

依照 `doc/furniture_platform_domain_design_v1.md` 實作的後端 API。

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

## 3) 已實作 API

所有核心路由現在都加上版本前綴 `/api/v1`，以便未來擴充。

- `GET /health`
- `GET /api/v1/feed?cursor=0&limit=20`  (items may be products or collections)
- `GET /api/v1/products/{product_id}`
- `GET /api/v1/products/{product_id}/drawer` (same data as detail)
- `POST /api/v1/wishlist/items`
- `POST /api/v1/viewlist/items`
- `POST /api/v1/collections`
- `POST /api/v1/collections/{collection_id}/items`
- `GET /api/v1/users/{user_id}/wishlist`
- `GET /api/v1/users/{user_id}/viewlist`

此外提供幾個輔助路由以符合設計文件：

- `GET /api/v1/collections`                      (list all scenes)
- `GET /api/v1/collections/{id}/items`           (collection contents)
- `DELETE /api/v1/collections/{id}/items/{item_id}`
- `GET /api/v1/wishlists/default?user_id=...`     (alias for user wishlist)
- `POST /api/v1/wishlists/default/items`         (same payload as normal)
- `DELETE /api/v1/wishlists/default/items/{id}?user_id=...`
- `GET /api/v1/viewlists/default?user_id=...`
- `POST /api/v1/viewlists/default/items`
- `DELETE /api/v1/viewlists/default/items/{id}?user_id=...`
- `POST /api/v1/auth/line/callback`               (stub OAuth endpoint)

## 4) 資料庫

- 目前使用 SQLite (`furni.db`)
- 程式啟動會自動建表並塞入 seed data
- 欄位與關聯對齊設計文件中的核心 domain model

## 5) 前端串接（index.html）建議

把 mock API 換成實際後端呼叫，例如：

```js
const res = await fetch(`/api/v1/feed?cursor=${cursor}&limit=${limit}`)
const data = await res.json()
appendFeed(data.items)
cursor = data.next_cursor ?? cursor
```

商品抽屜可改呼叫：

```js
GET /api/v1/products/{id}
``` 
或 `/api/v1/products/{id}/drawer`。

加入願望/看貨清單：

```js
POST /api/v1/wishlist/items
POST /api/v1/viewlist/items
```
