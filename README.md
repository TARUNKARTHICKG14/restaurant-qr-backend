<<<<<<< HEAD
# restaurant-qr-backend
=======
# restaurant-qr-backend

A lightweight **backend** for a contact‑less restaurant ordering system driven by QR codes on each table.  
This fork is based on the open‑source project **softenrj/qr‑menu** but strips out the client side to let us build a custom front‑end later.

## Quick start (local)
```bash
git clone <YOUR_REPO_URL>
cd restaurant-qr-backend
npm install
cp .env.example .env   # edit with your MongoDB / Supabase credentials
npm run dev            # runs with nodemon on http://localhost:3000
```

## What the repo contains
- **Express** server with REST endpoints for menu, orders, admin and QR‑code generation.
- **Mongoose** data models (Restaurant, Table, Customer, MenuItem, Order, OrderItem).
- **Socket.IO** real‑time feed for kitchen display and table‑specific updates.
- **Dockerfile** and **GitHub Actions** CI ready for deployment on Railway, Render, etc.

## License
MIT © 2024‑2026

>>>>>>> 2289db3 (feat: complete initial backend architecture with PostgreSQL, realtime Socket.IO, QR generation, GDPR validation and full test suite)
