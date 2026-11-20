<p align="center">
  <img src="./trax-md/assets/trax-md-logo.png" alt="TRAX-MD Logo" width="260" />
</p>

<h1 align="center">⚡ TRAX-MD</h1>

<p align="center">
  <strong>Next-Generation WhatsApp Multi-Device Bot &amp; Web Control Portal</strong>
</p>

---

## Overview

**TRAX-MD** is a modular Node.js WhatsApp Multi-Device bot (`trax-md/`) paired with a React + Express web portal for QR/Pairing-Code linking, multi-server session selection (`Server 1` – `Server 6`), live command testing, and 60 built-in WhatsApp commands across group management, automation, media/stickers, search, utilities, and owner controls.

---

## Requirements

- **Node.js** `>= 20.0.0`
- **npm** `>= 9.0.0`

---

## Run Locally

1. Install dependencies:

```bash
npm install
```

*(On Windows PowerShell if scripts are disabled, run `npm.cmd install`.)*

2. Start the Web Portal & Bot Server:

```bash
npm run dev
```

*(On Windows PowerShell if scripts are disabled, run `npm.cmd run dev`.)*

3. Open `http://localhost:3000` in your browser, choose a server (`Server 1` – `Server 6`), and link WhatsApp via **QR Code** or **Pairing Code**.

---

## Bot CLI Commands (`trax-md`)

```bash
# Verify plugins and syntax
node trax-md/index.js --check

# Run bot tests
npm --prefix trax-md test

# Run standalone bot CLI
npm --prefix trax-md start
```

---

## Configuration

Copy `trax-md/config.env.example` to `trax-md/config.env` if running standalone, or configure environment variables on your host:

- `OWNER_NUMBER=2557xxxxxxxx`
- `PREFIX=.`
- `MODE=public` (or `private`)

---

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import the repository in [Vercel](https://vercel.com/new) (configured via `vercel.json` and `api/index.ts`).
3. Click **Deploy**.
