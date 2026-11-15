/* ═══════════════════════════════════════════════════════════════════════════
   ORAL DOJO — FIREBASE CONFIG
   ----------------------------------------------------------------------------
   1. Go to https://console.firebase.google.com → "Add project" (e.g. oral-dojo)
   2. In the project: Project settings → General → Your apps → "</>" (Web app)
   3. Copy the firebaseConfig values it shows and paste them below.
   4. Follow FIREBASE-SETUP.md for the rest (Google sign-in, Firestore, rules).
   Until you paste real keys, the whole Dojo keeps working in LOCAL MODE
   (exactly like today: catalog.json + localStorage).
   ═══════════════════════════════════════════════════════════════════════════ */

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyCdEh8U8Dld1RE3z23VSfoXMxipXK81wGw",
    authDomain: "oral-dojo.firebaseapp.com",
    projectId: "oral-dojo",
    storageBucket: "oral-dojo.firebasestorage.app",
    messagingSenderId: "929469312458",
    appId: "1:929469312458:web:e336f82dfb9007582ef333"
};

/* Admin allowlist — the Google accounts allowed to unlock the Admin Console.
   Keep this list identical to the one in firestore.rules (both must change
   together). Leave empty [] to use the PIN-only mode (no Google gate), but
   note: Firestore RULES will still block catalog writes and the Inbox unless
   a signed-in email is allowlisted there. */
var ADMIN_EMAILS = [
  "oraldojo.ttosr@gmail.com"
];
