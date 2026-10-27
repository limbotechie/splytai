# Splyt

> Private, browser-encrypted ZEC reimbursement product. Zero plaintext on the relay.

## Overview

Splyt turns shared real-world expenses into private, shielded Zcash (ZEC) reimbursement requests.

Traditional bill-splitting apps store receipts, member relationships, itemized consumption, and transaction graphs on central servers. Splyt eliminates this privacy leak:

1. **Client-Side Decryption Only**: All receipt recognition, item parsing, allocation math, and cryptographic keys live exclusively in the browser's private workspace (IndexedDB).
2. **Blind Ciphertext Relay**: The backend relay server never receives plaintext. It stores only AES-256-GCM encrypted envelopes, revision counters, and cryptographic hashes of access capabilities.
3. **Fragment-Isolated Content Keys**: Decryption keys are delivered to participants via URL fragments (`#v=1&r=...&s=...`). The fragment is never transmitted in HTTP requests and is stripped from the browser URL and history immediately upon capture.
4. **Shielded Testnet Only**: Receiving addresses must pass the real Zcash parser for testnet Sapling or a supported shielded-only Unified Address. Mainnet, invalid checksums, and transparent fallback are rejected.
5. **ZIP 321 Wallet Handoff**: Participants use an external wallet that supports Zcash testnet and ZIP 321 payment requests. Splyt never imports private keys, holds custody, broadcasts transfers, or claims untested wallet compatibility.
6. **Manual Signed Confirmations**: Organisers verify incoming transactions in their own wallets and issue signed cumulative payment confirmations.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Organiser Browser                    │
│  - Local Tesseract WASM OCR (Zero image upload)       │
│  - WebCrypto AES-256-GCM Key Generation                │
│  - IndexedDB Workspace (splyt-private-v1)              │
│  - Organiser Manifest & Capability Management          │
└──────────────────────────┬─────────────────────────────┘
                           │
                 Blind AES-GCM Envelopes
            (Encrypted Manifest + Requests)
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                Splyt Relay Server                      │
│  - Express 5 + MongoDB                                 │
│  - Capability Token Verification (SHA-256 Hashes)      │
│  - Strict Revision Guard & Write Gate                  │
│  - 30-Day Automatic Envelope Expiry                    │
│  - Zero Plaintext Access                               │
└──────────────────────────▲─────────────────────────────┘
                           │
                 Blind AES-GCM Envelopes
            (Encrypted Offer + Payment Reports)
                           │
┌──────────────────────────┴─────────────────────────────┐
│                  Participant Browser                   │
│  - URL Fragment Ingestion (#v=1&r=...&s=...)           │
│  - Immediate URL History Stripping                     │
│  - Decrypts Individual Share & Items                   │
│  - ZIP 321 QR Code / URI Generation                    │
│  - Encrypted Payment Report Submission                 │
└────────────────────────────────────────────────────────┘
```

---

## Monorepo Layout

- [`apps/web`](apps/web): Next.js 16 web application with client-side WebCrypto, IndexedDB private workspace, self-hosted Tesseract.js WebAssembly OCR, and shielded Zcash address validation.
- [`apps/backend`](apps/backend): Express 5 blind relay server backed by MongoDB for storing encrypted envelopes and proxying ZEC/fiat conversion rates.
- [`implementation docs/`](implementation%20docs/): Detailed living project context, implementation plans, and verification ledgers.

---

## Quick Start

### Prerequisites

- **Node.js**: v20 or v22
- **npm**: v10+
- **MongoDB**: v6.0+ (local instance or MongoDB Atlas URI)

### 1. Installation

```bash
npm install --no-audit --no-fund
```

### 2. Prepare Self-Hosted OCR Assets

Populate the WebAssembly OCR worker and language models into `apps/web/public/tesseract/` (ensures 100% offline OCR with zero CDN calls):

```bash
node apps/web/scripts/prepare-assets.mjs
```

### 3. Environment Configuration

Create `.env` in `apps/backend/`:

```env
PORT=3001
WEB_ORIGIN=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=splyt_private_dev
```

Create `.env.local` in `apps/web/`:

```env
NEXT_PUBLIC_RELAY_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ZCASH_NETWORK=testnet
```

These loopback URLs are explicit local-development settings for real running services,
not runtime fallbacks. The app never substitutes demo data when a service is unavailable.

For deployment, create new Render and Vercel services for this project. Do not reuse
template deployments. Configure Render's `WEB_ORIGIN` with the new frontend HTTPS origin,
`MONGODB_URI` with its real database connection, and a fresh `MONGODB_DB` starting with
`splyt_private_`. `render.yaml` intentionally leaves these values unset and uses
`/api/health` as its readiness path.

Before building on Vercel, set `NEXT_PUBLIC_RELAY_URL` to the new relay's HTTPS base URL,
`NEXT_PUBLIC_APP_URL` to the new frontend's HTTPS origin, and
`NEXT_PUBLIC_ZCASH_NETWORK=testnet`. Public settings are compiled into the web bundle;
changing them requires a rebuild. Missing or invalid settings show a configuration error.

The relay indicator becomes connected only after the configured service returns the
current Splyt health contract following a successful MongoDB ping. This is relay/database
readiness, not a blockchain or wallet connection. Payment reports and organiser
acknowledgements never claim independent on-chain verification.

Rates come from CoinGecko's real public API with source timestamps. An unavailable or
stale rate requires refresh or an explicitly entered manual ZEC amount, never an invented
price. Testnet coins have no monetary value.

### 4. Run Development Servers

In terminal 1 (start backend relay):
```bash
npm run dev -w apps/backend
```

In terminal 2 (start frontend web app):
```bash
npm run dev -w apps/web
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Key Security Properties

| Property | Implementation |
| --- | --- |
| **Zero Plaintext on Relay** | All bills, amounts, participant names, and allocations are encrypted before network dispatch using AES-256-GCM. |
| **Fragment Key Isolation** | Invite keys are carried in the `#` fragment and immediately stripped via `history.replaceState` upon load. |
| **Shielded Address Enforcement** | Transparent addresses (`t1`, `t3`) are rejected at the input boundary. |
| **Replay & Rollback Resistance** | The relay rejects stale revisions and re-uses of revoked capability tokens. |
| **Write-Gate Reconciliation** | Local edits require a fresh `sync:<billId>` receipt newer than any restore operation. |
| **Passphrase-Protected Backup** | Workspace exports use PBKDF2-HMAC-SHA-256 with 600,000 iterations and AES-GCM. |

New drafts are encrypted in the same workspace as bills and included in backup/clear
operations. Template-era browser databases are neither imported nor deleted automatically.
Failed remote deletion preserves the remaining local records and capabilities for retry.

## Validation

```bash
npm test
npm run lint
npm run typecheck
npm run typecheck:private -w apps/web
npm run build
```

Test fixtures and doubles are confined to automated tests. Backend integration tests use
a real isolated MongoDB process. Neither automated fixtures nor passing builds establish
a live deployment or a completed wallet transfer; executed results belong in the
implementation validation ledger.

---

## License

MIT
