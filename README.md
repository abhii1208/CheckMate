# CheckMate — Smart Inventory Stock Verification Tool

CheckMate is a full-stack inventory audit application built with **React**, **Node.js/Express**, and **PostgreSQL**. It helps operations teams upload stock sheets, scan product barcodes, verify actual counts, and keep a clean audit trail.

## Features

- Upload `.xlsx` or `.csv` inventory files
- Preview spreadsheet data before import
- Scan barcodes via:
  - camera scanner
  - external USB/Bluetooth scanner
  - manual entry
- Compare `actual stock` vs `expected stock`
- Highlight matches and mismatches instantly
- Save stock verification results and maintain historical logs
- Responsive white + green UI with dashboard and reports

## Project structure

```text
root/
├── client/        # React frontend (Vite)
├── server/        # Node.js + Express API
├── database.sql   # PostgreSQL schema
└── README.md
```

## Database setup

1. Create a PostgreSQL database named `checkmate`.
2. Run the schema:

```bash
psql -U postgres -d checkmate -f database.sql
```

## Environment variables

### Server (`server/.env`)

Copy the example file and update values:

```bash
copy server\.env.example server\.env
```

Example:

```env
PORT=5000
CLIENT_URL=http://localhost:5173
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/checkmate
```

### Client (`client/.env`)

```bash
copy client\.env.example client\.env
```

Example:

```env
VITE_API_URL=http://localhost:5000/api
```

## Install dependencies

### Backend

```bash
cd server
npm install
```

### Frontend

```bash
cd ../client
npm install
```

## Run locally

Open two terminals.

### Terminal 1 — API

```bash
cd server
npm run dev
```

### Terminal 2 — Frontend

```bash
cd client
npm run dev
```

Frontend: `http://localhost:5173`
Backend API: `http://localhost:5000/api`

## Expected upload columns

Your Excel/CSV file should contain at least these columns:

- `name`
- `barcode`
- `expected_stock`

Example CSV:

```csv
name,barcode,expected_stock
Green Tea Box,890100100001,24
Rice Pack 5kg,890100100002,12
Soap Bar,890100100003,40
```

## REST API endpoints

- `POST /api/upload` — upload inventory spreadsheet
- `GET /api/product/:barcode` — fetch one product by barcode
- `POST /api/update-stock` — save actual stock and write logs
- `GET /api/logs` — fetch verification history
- `GET /api/dashboard` — summary counters for dashboard
- `GET /api/products` — product listing for UI tables

## Notes

- Duplicate barcode scans are ignored briefly to prevent accidental double entries.
- Camera permission errors are handled in the UI with fallback to scanner/manual entry.
- Stock changes are logged in `stock_logs` for traceability.

## Verification status

The following checks were run successfully in this workspace:

- `client`: `npm run build`
- `server`: `npm run check`
- `server`: app initialization via `node -e "require('./src/app'); console.log('app ok')"`
