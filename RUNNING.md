# Running NetGuard

## Prerequisites

- **Python 3.11** (required — 3.14 hangs on SQLAlchemy import)
- **Node.js 18+** (includes `npm`)

Verify:

```powershell
python3.11 --version
node --version
npm --version
```

## 1) Backend setup (FastAPI)

1. Create your environment file — copy `backend/.env` and fill in:
   - `SOPHOS_HOST`, `SOPHOS_PORT`, `SOPHOS_USERNAME`, `SOPHOS_PASSWORD`
   - `SOPHOS_FIREWALL_RULE`
   - `JWT_SECRET`

2. Install Python dependencies:

```powershell
cd backend
python3.11 -m pip install -r requirements.txt
```

3. Run the backend:

```powershell
cd backend
python3.11 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Backend URL: `http://localhost:8000`

> **Note:** Use `python3.11` explicitly — not `python`. Python 3.14 will hang on startup.

## 2) Frontend setup (Vite + React)

1. Install Node dependencies:

```powershell
cd frontend
npm install
```

2. Run the frontend dev server:

```powershell
cd frontend
npm run dev
```

Frontend URL: `http://localhost:5173`

## Running both (open two terminals)

**Terminal 1 — Backend:**
```powershell
cd backend; python3.11 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**
```powershell
cd frontend; npm run dev
```

> PowerShell uses `;` to chain commands, not `&&`.

## Common issues

### Ports already in use

```powershell
netstat -ano | findstr ":8000"
netstat -ano | findstr ":5173"
```

Kill by PID:
```powershell
taskkill /PID <pid> /F
```

### Backend hangs on startup

Make sure you're using `python3.11`, not `python` or `python3`. Run `python3.11 --version` to confirm.

### Frontend can't reach backend

The frontend auto-detects the backend URL:
- On localhost → `http://localhost:8000`
- On another host → `http://<hostname>:8000`
- Override with `VITE_API_URL` in `frontend/.env.local`
