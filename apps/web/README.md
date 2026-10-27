# Splyt Web Application (`apps/web`)

The Next.js 16 client for Splyt, an accountless, browser-encrypted ZEC reimbursement product.

## Key Features

- **Browser Private Workspace**: Decrypts and stores drafts, bills, participant invites, and capability secrets in client-side IndexedDB (`splyt-private-v1`) using AES-256-GCM via the WebCrypto API.
- **Self-Hosted Local OCR**: Recognizes receipt text using client-side WebAssembly workers from `@/public/tesseract/`. Never transmits images or text to remote servers or CDNs.
- **Shielded Zcash Tooling**: Strict parser-backed shielded address validation (Sapling and Orchard Unified Addresses) and ZIP 321 payment request URI generation.
- **Fragment Key Security**: Ingests participant invite secrets via URL fragments (`#v=1&r=...&s=...`) and immediately purges the fragment from browser URL and history.
- **Passphrase-Protected Backup**: Exports and imports encrypted JSON snapshots with automatic relay write-gate reconciliation.

## Scripts

```bash
# Prepare self-hosted OCR assets (worker, WASM binaries, English traineddata)
node scripts/prepare-assets.mjs

# Start development server on port 3000
npm run dev

# Run private privacy modules typecheck
npm run typecheck:private

# Run unit tests
npm test

# Validate first-party code and production output
npm run lint
npm run typecheck
npm run build
```

## Environment Configuration

Create `.env.local`:

```env
NEXT_PUBLIC_RELAY_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ZCASH_NETWORK=testnet
```

The localhost relay URL is for local development only. A deployed testnet app must set
`NEXT_PUBLIC_RELAY_URL` to the live relay's HTTPS endpoint; there is no localhost
fallback. Transfers are handed off to an external Zcash testnet wallet through ZIP 321.

Create new deployments for this project; inherited Render/Vercel hosts must not be used.
Set both public URLs to the new HTTPS services before building, then rebuild whenever
they change. Configure the relay's `WEB_ORIGIN` to match the new frontend origin.
The connected indicator requires a successful current relay health response backed by
a real MongoDB request. Missing configuration, unavailable services, and failed actions
remain explicit errors; the app never fills them with demo data or simulated success.
