/* Firebase client setup.
 * These client config values identify your Firebase project; Firestore Rules and
 * Cloud Functions enforce access. Never put service-account JSON or payment
 * provider secret keys in this file.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDzDjgSqldDD7DLomACfr95ZKpnCzq4_cE",
  authDomain: "socialpay-morrish.firebaseapp.com",
  projectId: "socialpay-morrish",
  storageBucket: "socialpay-morrish.firebasestorage.app",
  messagingSenderId: "736329222171",
  appId: "1:736329222171:web:d122b49971db82c93490be",
  measurementId: "G-VSVFVJKS3M"
};

export const firebaseConfigured = Object.values(firebaseConfig).every(
  value => typeof value === "string" && value.length > 0 && !value.startsWith("YOUR_")
);

let app = null;
export let auth = null;
export let db = null;
export let functions = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app, "us-central1");
}
