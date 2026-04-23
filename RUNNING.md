# Running NetGuard (new machine setup)

These instructions assume you have this repo on your machine at `netguard/`.

## Prerequisites

- **Python**: 3.10+ recommended (must be on PATH)
- **Node.js**: 18+ recommended (includes `npm`)

Verify:

```bash
python --version
node --version
npm --version
```

## 1) Backend setup (FastAPI)

1. Create your environment file:

   - Copy `backend/.env.example` to `backend/.env`
   - Fill in values (Sophos + Google OAuth + JWT secret + frontend URL)

2. Install Python dependencies:

```bash
cd backend
python -m pip install -r requirements.txt
```

3. Run the backend:

```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```

Backend URL: `http://localhost:8000`

## 2) Frontend setup (Vite + React)

1. Install Node dependencies:

```bash
cd frontend
npm install
```

2. Run the frontend dev server:

```bash
cd frontend
npm run dev
```

Frontend URL: `http://localhost:5173`

## One-command start (Windows)

From the repo root:

```bat
start.bat
```

This opens two new `cmd` windows:
- Backend: installs requirements (if needed) and starts Uvicorn on port 8000
- Frontend: installs npm deps (if needed) and starts Vite on port 5173

## Common issues

### “Resource busy” / can’t delete `frontend`

That almost always means a dev server is still running.

- Stop **Vite/Node** processes (frontend)
- Stop **Uvicorn/Python** processes (backend)
- Also close any File Explorer windows currently inside the folder you’re deleting

### Ports already in use

If `8000` or `5173` are already taken, stop the process using the port or start on a different port.

Windows quick check:

```bat
netstat -ano | findstr ":8000 :5173"
```

