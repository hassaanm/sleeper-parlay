// Firebase Realtime Database URL, e.g. "https://parlay-pool-default-rtdb.firebaseio.com".
// Leave it empty to keep slips in this browser only (handy for local prototyping).
export const FIREBASE_DB_URL = 'https://parlay-picker-b8aa0-default-rtdb.firebaseio.com';

// SHA-256 of the admin password for "<league URL>?admin", the same for every league.
// This keeps casual visitors out; it is not real security (the app is public and has
// no server).
export const ADMIN_PASSWORD_SHA256 = 'a6cbe6a947ae32119a1227613be8c56fe49dfaaef9863b5633f391d314e7f23c';
