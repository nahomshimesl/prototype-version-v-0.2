/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, query, where, orderBy, getDocFromServer } from 'firebase/firestore';
import { healthEngine } from './services/HealthEngine';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Set persistence to local to avoid session issues in iframes
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.error("Auth persistence error:", err);
});

export const googleProvider = new GoogleAuthProvider();
// Custom parameters to improve popup behavior
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Error handling for Firestore
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  /**
   * Whether a user was signed in at the time of the failure. We deliberately
   * do NOT include uid, email, tenantId, or any provider profile fields
   * (display name, email, photo URL) here. Firestore failures used to bubble
   * those up via a thrown Error → unhandledrejection → /api/sentinel/report
   * and /api/system/logs (which is also fed to Gemini for diagnosis), turning
   * a routine database error into a PII leak across the diagnostic pipeline.
   * Diagnosis only needs to know that the failing call was authenticated.
   */
  authenticated: boolean;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    operationType,
    path,
    authenticated: !!auth.currentUser?.uid,
  };
  // Local console diagnostics: identity-free. Avoids leaking PII into any
  // browser extension or capture mechanism that scrapes console output.
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  // Report to Health Engine. The details object intentionally carries only
  // the (already access-controlled) document path and an opaque "auth" flag
  // — never email, UID, tenant, or provider data.
  healthEngine.reportExternalError(
    `Firestore:${operationType}`,
    errMsg,
    'MEDIUM',
    { path, auth: errInfo.authenticated }
  );

  // The thrown Error propagates into window.onerror / unhandledrejection
  // handlers in SentinelClient and HealthEngine, which forward the message
  // to backend telemetry. The serialized payload here must therefore stay
  // strictly identity-free.
  throw new Error(JSON.stringify(errInfo));
}

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

export { collection, addDoc, deleteDoc, doc, onSnapshot, query, where, orderBy, signInWithPopup, signOut };
