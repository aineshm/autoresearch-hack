# AutoLab Backend

Minimal auth API — Express + local SQLite (`node:sqlite`, no native build needed).

## Run

```bash
cd backend
npm install
npm run dev      # or: npm start
```

Server: `http://localhost:4000`. The database file is created automatically at `backend/data/app.db`.

## Endpoints

| Method | Path               | Body                          | Notes                       |
|--------|--------------------|-------------------------------|-----------------------------|
| GET    | `/api/health`      | —                             | Health check                |
| POST   | `/api/auth/signup` | `{ email, password, name? }`  | Returns `{ token, user }`   |
| POST   | `/api/auth/login`  | `{ email, password }`         | Returns `{ token, user }`   |
| GET    | `/api/auth/me`     | — (Bearer token)              | Returns `{ user }`          |

Passwords are hashed with bcrypt; auth uses a JWT (7-day expiry).
Set `JWT_SECRET` and `PORT` via env vars in production.
