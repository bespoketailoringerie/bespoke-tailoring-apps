# Bespoke Tailoring registers — notes for Claude

Read this first. This repo holds the shop's two register apps and publishes their downloads.
**It is public**: never commit keys, passwords, customer data or anything from a real register's data file.

## The two apps

- **Bespoke Register** (`pos/`): the shop's Windows computer. Electron. Tabs: Register (item tags,
  scanning, Custom filter with the made-to-measure price list, markup and set-price cards), Customers,
  Returns, Stock (sizes/colors, barcodes, labels), Sales, Staff (time clock, schedule, timesheets, sales
  by employee, shift notes, cash drawer, employees), Settings.
- **The Alterations app** (`tablet/`): what the owner calls the 10.5" Android tablet register.
  Capacitor. Tabs: Register, Tags (open alteration tags by due date), Customers. Alteration tags follow
  the shop's paper tag (coat, vest, trousers, dress, patches...) with prices, rush fees and due dates.

Each app's whole interface and logic is one file: `pos/app/index.html` and `tablet/www/index.html`
(the POS file embeds its logo as base64, so it's large; edit it with targeted replacements, not by
reading it whole). `pos/main.js` + `pos/preload.js` are the Windows shell (saving, printing, email,
backups, updates).

`shared/` holds code both apps use. The build copies it into each app (those copies are gitignored):
- `customer-sync.js`: customers and customer spending, via the website's `/api/customer-sync`
- `tag-sync.js`: alteration tags, via `/api/tag-sync`
- `card-pay.js`: the card reader (PAX A920 Pro on Merchant360, Electronic Payments), via `/api/card-pay`

## Publishing a new version

1. Make the change on `main`.
2. Raise the number in `VERSION` (it must go up every time; minor for features, patch for fixes).
3. Push. The **Build and release** workflow builds the Windows installer and the signed APK and
   publishes them as one GitHub release (`v1.2.3`).

The shop computer checks for updates when it opens and every 4 hours, downloads in the background and
asks before restarting. The tablet shows a notice with a download link; the owner taps Install.
Pushing to the `test-build` branch builds both apps without publishing anything.
The tablet is signed with `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD` (repo secrets); every
version must use that same key or Android won't install it over the old one.

Check the run with `gh run list` / `gh run watch` and the release with
`gh api repos/bespoketailoringerie/bespoke-tailoring-apps/releases/latest`.

## Where data lives

- Shop computer: `%APPDATA%\Bespoke Register\register-data.json` (written safely via a temp file, with
  a `.bak`), plus a daily backup copy kept 60 days (folder chosen in Settings). Reinstalling keeps it.
- Tablet: the app's localStorage (`bespoke-tablet-v1`).
- Money is always whole cents.

## Syncing with the website

The website (`bespoketailoringerie/bespoke-tailoring-erie`, see its CLAUDE.md) is the hub. Each
register has its own key (Netlify `POS_APP_KEY` / `TABLET_APP_KEY`), entered once on the device through
the **Customer list** status button at the top of the screen (both apps work the same way). Downloads never contain a key.

- Everything is kept locally and sent through an outbox, so a register works offline and catches up.
- Customers sync first (a new customer needs its website id before its tags or sales can go up).
- Tags are written on the tablet only (tag numbers come from the tablet's `nextTag`). The shop computer
  shows each customer's tags on its Customers tab and doesn't change them.
- A clash on a tag: a paid tag stays paid, otherwise the newer edit wins; the website decides and both
  registers take its copy. An unsent local edit is never overwritten by a pull.
- If the website doesn't have an endpoint yet (404), the apps treat it as "not set up" and keep data.
- Changing what a register sends must stay compatible with the website's endpoints (deploy the
  website change first, or together).

## Card reader

- The reader is a PAX A920 Pro on Merchant360. The Merchant360 key lives only on the website (Netlify
  `M360_SECRET_KEY`); the registers ask `/api/card-pay` with their own register key. Never put a
  Merchant360 key in this repo or the apps.
- In the payment screen, Card shows **Send $x to the card reader** when the website says the reader is
  set up (`GET /api/card-pay` → ready). Otherwise (not set up, offline, older website) it shows the old
  "key it into the terminal" steps, and staff can always switch to them.
- A reader payment is kept on the sale as `payments[].reader` `{ id, last4, auth, brand, test? }`.
  Voiding the receipt voids that charge (or refunds it once the day has closed); the POS Returns tab
  refunds it to the card. "Undo" on a reader payment is "Void card charge".
- A sale still waiting when the app closes is kept in localStorage `bespoke-card-pending`; on the next
  start the app checks it and offers to void a charge that went through.
- Merchant360's live card-present processing is waiting on their certification; until then a live key
  answers 503 and the apps explain it and fall back to keying it in.

## Testing

- Opening `pos/app/index.html` in a browser runs a **preview** with sample items, sales, staff and
  tags (no `window.pos` bridge): nothing is saved, printed or sent. Example staff PINs 1234 / 2468.
- The tablet runs in a browser too; it acts as the installed app when `window.Capacitor` reports a
  native platform.
- Chromium for Playwright is at `/opt/pw-browsers` (set `PLAYWRIGHT_BROWSERS_PATH`). For a full sync
  test: run the website's functions locally behind a small HTTP server (with an in-memory
  `@netlify/blobs` stand-in), give the POS a fake `window.pos` bridge whose settings point at it, and
  give the tablet a fake Capacitor plus a localStorage connection.
- Syntax-check each app's inline scripts with `node --check` after editing.

## The owner's preferences

- The look matches the website: red / gold / cream, Gloock headings, Lora text, Courier Prime capitals
  for labels and buttons, square framed cards, logo top left.
- Plain wording; messages say what happened and what to do.
- Card payments are keyed into the terminal for now. Terminal integration is undecided: they use
  Electronic Payments (a Dejavoo Z8 today) and have looked at Valor VL100 and Stripe Reader T600.
- When asked for a change, make exactly that change, test it, publish a new version, and say in plain
  words what changed and how to update.

## Working on it

- Pull before starting and push when done; other Claude sessions may also work here.
- Commit messages: `Publish x.y.z: <summary>` when the version changes, then bullets.
