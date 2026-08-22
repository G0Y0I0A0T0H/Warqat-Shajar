# Waraqat Shajar -- Android app shell

A thin native Android wrapper around https://waraqatshajar.com, built with
[Capacitor](https://capacitorjs.com/). It does not bundle any of the site's
own HTML/CSS/JS -- the app loads the live site directly (see `server.url` in
`capacitor.config.json`), so every update already pushed to the live site
shows up in the app immediately, with no app rebuild or store resubmission
needed.

## Requirements

- Node.js (this project was built with Node 24 / npm 11)
- Android Studio (for building/running/signing the app) -- the Android SDK
  and a JDK ship bundled with it, nothing else to install separately

## Building

```bash
npm install
npx cap sync android
npx cap open android
```

The last command opens `android/` in Android Studio. From there: Run ▶ to
install on a connected device or emulator, or Build > Generate Signed App
Bundle/APK to produce a release build for the Play Store.

To build a debug APK from the command line instead (what was used to verify
this setup):

```bash
cd android
.\gradlew.bat assembleDebug
```

The output APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Known limitation: Google Sign-In

The site offers "Sign in with Google" (`signInWithPopup`/`signInWithRedirect`
+ `GoogleAuthProvider` in `js/firebase.js`). Google actively blocks its own
OAuth sign-in flow inside a plain embedded WebView like this app's -- it's a
deliberate anti-phishing measure on Google's end (shows as "Error 403:
disallowed_useragent"), not a bug in this app. It has nothing to do with
Firebase or this project's config; any app built by simply wrapping a
website in a WebView hits the same wall.

Email/password and phone-based sign-in are regular web forms, not an
embedded OAuth popup, so they aren't affected and should work normally
inside the app. Google Sign-In specifically will not work from inside the
app until it's wired up to use Google's *native* sign-in SDK instead (e.g.
via the `@capacitor-firebase/authentication` plugin) or opened in a system
browser tab instead of the embedded WebView (`@capacitor/browser`) -- both
are real, separate follow-up pieces of work, not part of this initial shell.

## App identity

- Package/App ID: `com.waraqatshajar.app` -- this is permanent once
  published to the Play Store, so double check it's what's wanted before
  the first release build.
- App icon and splash screen were generated from `images/favicon.png` (the
  square logo already used as the site's own favicon), on a solid
  `#2e7d32` background (`#1b3a1d` in dark mode) -- see `assets/` and
  `npx capacitor-assets generate` if they ever need regenerating from a
  different source image.

## iOS

Not set up. Building an iOS app requires a Mac (or a cloud Mac build
service) -- Xcode has no Windows version, so it isn't possible from this
machine. Adding the `ios` platform later (`npx cap add ios`) is
straightforward once Mac/cloud-Mac access is available; nothing about this
Android setup needs to change for that.
