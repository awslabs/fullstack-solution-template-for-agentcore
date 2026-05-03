import { initializeApp, cert, type ServiceAccount, getApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { readFileSync } from "fs";
import { resolve } from "path";

let initialized = false;

function ensureInit() {
  if (!initialized) {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyPath) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to your service account key path");
    const sa = JSON.parse(readFileSync(resolve(keyPath), "utf-8")) as ServiceAccount;
    initializeApp({ credential: cert(sa), storageBucket: "docent-76d5a.firebasestorage.app" });
    initialized = true;
  }
}

export function getDb(): Firestore {
  ensureInit();
  return getFirestore();
}

export function getBucket() {
  ensureInit();
  return getStorage().bucket();
}
