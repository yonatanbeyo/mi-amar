# Building the site

`index.html` = `src/template.html` (copied as is). `app.js` = bundle of `src/entry.ts`:

    npm i firebase@10.14.1 qrcode-generator@1.4.4 jszip esbuild
    npx esbuild src/entry.ts --bundle --format=iife --minify --target=es2020 --outfile=app.js
    cp src/template.html index.html && cp src/stats.html stats.html

`firebase-rules.json` must also be pasted by hand into Firebase console → Realtime Database → Rules.
