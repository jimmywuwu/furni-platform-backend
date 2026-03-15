# TypeScript + Cloudflare D1 重構說明

## 新的主架構

專案主執行入口已改成：

- Runtime: Cloudflare Workers
- 語言: TypeScript
- HTTP framework: Hono
- Database: Cloudflare D1

主要檔案：

- `src/index.ts`: API 入口與所有 routes
- `wrangler.toml`: Workers + D1 + assets 設定
- `deploy/cloudflare/schema.sql`: D1 schema
- `deploy/cloudflare/seed.sql`: 現有資料的 D1 seed
- `public/index.html`: 前端靜態頁面

## 本地開發

安裝依賴：

```bash
npm install
```

初始化本地 D1：

```bash
npm run db:reset:local
```

啟動本地服務：

```bash
npm run dev
```

預設會跑在：

```text
http://127.0.0.1:8000
```

## 測試

Smoke test：

```bash
npm test
```

測試會：

1. 匯入 schema
2. 匯入 seed
3. 啟動本地 wrangler dev
4. 驗證 health、feed、product、auth、wishlist API
