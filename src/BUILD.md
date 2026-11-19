# Building the site

`index.html` = `src/template.html` (copied as is). `app.js` = bundle of `src/entry.ts`. `admin.js` = bundle of `src/admin.ts`:

    npm i firebase@10.14.1 qrcode-generator@1.4.4 jszip esbuild
    npx esbuild src/entry.ts --bundle --format=iife --minify --target=es2020 --outfile=app.js
    npx esbuild src/admin.ts --bundle --format=iife --minify --target=es2020 --outfile=admin.js
    cp src/template.html index.html && cp src/stats.html stats.html && cp src/admin.html admin.html && cp src/terms.html terms.html

`firebase-rules.json` must also be pasted by hand into Firebase console → Realtime Database → Rules.

## Premium (src/premium.ts)
- Year summary, media round, certificates and the Bit payment window. Everything about the chat runs on the device.
- A paid chat is remembered by a one-way fingerprint (`unlocks/<key>`). Payments wait in `pay/<code>` until approved in `admin.html`.
- Only the Google account in the rules (and in `src/admin.ts`) can read payments or unlock. Firebase console → Authentication → Sign-in method: Google must be on, and the site's domain must be in the authorized domains.
- Media for phones goes phone-to-phone (WebRTC data channel). Firebase only carries the short setup messages under `games/<code>/x`.
