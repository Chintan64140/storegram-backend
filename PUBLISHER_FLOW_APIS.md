# Publisher Upload, View Tracking, and Earnings APIs

Base URL examples below assume local server: `http://localhost:5000`.

## 1. Publisher uploads a file

`POST /publisher/content/upload`

Auth: `Authorization: Bearer <publisher_token>`

Form data:

```text
file: <video file>
title: Optional title
duration: Video duration in seconds
```

Storage behavior:

The publisher file is uploaded to Cloudflare R2 using the existing R2/S3 client config. The local `uploads/` folder is only temporary for multer; after `PutObjectCommand` succeeds, the temp file is deleted and the API stores the R2 public URL in the `files.file_url` column.

Response includes:

```json
{
  "message": "File uploaded successfully",
  "shortLink": "http://localhost:5000/api/files/abc123",
  "tracking": {
    "start": "http://localhost:5000/api/files/abc123/view/start",
    "heartbeat": "http://localhost:5000/api/files/abc123/view/:viewId/heartbeat",
    "end": "http://localhost:5000/api/files/abc123/view/:viewId/end"
  },
  "file": {
    "id": "file_uuid",
    "publisher_id": "publisher_uuid",
    "title": "Video title",
    "file_url": "https://...",
    "duration": 120,
    "short_id": "abc123",
    "total_views": 0,
    "total_earnings": 0
  }
}
```

Compatibility route: `POST /api/files/upload` also works with the same auth and form data.

## 2. Viewer opens the short link

`GET /api/files/:shortId`

Auth: public.

Response includes video details and the watch threshold. A view counts when the viewer watches 10% of the video, capped at 20 seconds for long videos.

```json
{
  "message": "File retrieved successfully",
  "tracking": {
    "thresholdSeconds": 12,
    "startUrl": "http://localhost:5000/api/files/abc123/view/start"
  },
  "file": {
    "id": "file_uuid",
    "title": "Video title",
    "file_url": "https://...",
    "duration": 120,
    "short_id": "abc123"
  }
}
```

## 3. Viewer starts tracking

`POST /api/files/:shortId/view/start`

Auth: public.

Optional JSON body for location:

```json
{
  "location": "Mumbai, India"
}
```

or:

```json
{
  "city": "Mumbai",
  "region": "Maharashtra",
  "country": "India"
}
```

Response:

```json
{
  "message": "View tracking started",
  "viewId": "view_uuid",
  "thresholdSeconds": 12
}
```

The API saves `file_id`, `publisher_id`, `watch_time`, `is_valid`, `location`, `ip_address`, and `created_at` in the `views` table.

## 4. Viewer heartbeat while video plays

`POST /api/files/:shortId/view/:viewId/heartbeat`

Auth: public.

Body:

```json
{
  "watchTimeSeconds": 15,
  "location": "Mumbai, India"
}
```

Response:

```json
{
  "message": "View heartbeat saved",
  "viewId": "view_uuid",
  "watchTimeSeconds": 15,
  "thresholdSeconds": 12,
  "canCountView": true
}
```

## 5. Viewer ends tracking and publisher earns

`POST /api/files/:shortId/view/:viewId/end`

Auth: public.

Body:

```json
{
  "watchTimeSeconds": 15,
  "location": "Mumbai, India"
}
```

If valid, the API:

- Marks the view row as `is_valid = true`.
- Increments file `total_views`.
- Increments file `total_earnings`.
- Adds `0.01` to publisher `wallet_balance`.
- Creates an `APPROVED` row in `transactions`.

Response:

```json
{
  "message": "Valid view counted and publisher earning credited",
  "viewId": "view_uuid",
  "finalWatchTime": 15,
  "thresholdSeconds": 12,
  "isValidView": true,
  "credited": true,
  "earningAmount": 0.01,
  "walletBalance": 4.21
}
```

Calling `end` again for the same `viewId` will not credit again.

## 6. Publisher checks earnings

`GET /api/payments/earnings`

Auth: `Authorization: Bearer <publisher_token>`

Response includes current wallet balance, total approved earnings, and transaction history.

## 7. Publisher dashboard and content

`GET /publisher/analytics/dashboard`

`GET /publisher/analytics/views`

`GET /publisher/content`

Auth: `Authorization: Bearer <approved_publisher_token>`

## DB tables used

No new table is required for this flow. It uses:

- `users`: publisher account, approval, wallet balance.
- `files`: uploaded file, short link, total views, total earnings.
- `views`: viewer tracking, watch time, location, IP address, valid view flag.
- `transactions`: publisher earning records.
