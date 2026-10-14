# Bespoke Tailoring apps

Downloads and source for Bespoke Tailoring's two registers:

- **`pos/`** — Bespoke Register for the shop's Windows computer (Electron). Installs with the
  `Bespoke-Register-Setup-x.y.z.exe` from the latest release and updates itself after that.
- **`tablet/`** — Bespoke Register for the 10.5" Android tablet (Capacitor). Install the
  `Bespoke-Register-Tablet-x.y.z.apk` from the latest release. When a new version is out the app
  shows a notice with a download link; open the file and tap **Install**.

Neither download contains a register key. Each device is given its key once during setup.

## Publishing a new version

Change the number in the `VERSION` file on `main` (for example `1.0.0` → `1.0.1`). That starts the
**Build and release** workflow, which builds both apps and publishes them as one release; the
devices pick it up from there. The number must go up each time.

## Signing

The tablet app is signed with the key stored in this repo's secrets (`ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`). Every version must use the same key or Android won't install it over
the old one, so keep the backup copy of that key safe.
