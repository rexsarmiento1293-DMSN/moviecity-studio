import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { DramaProject, calculateTotalTimelineDuration } from './utils/dramaStudioLogic';

// Initialize Firebase App, Firestore (with named database ID), Auth, and Analytics
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const dbDefault = getFirestore(app);
export const auth = getAuth(app);
export { doc, setDoc, getDocFromServer, getDoc, collection, query, where, getDocs };

export let analytics: Analytics | null = null;
if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported && firebaseConfig.measurementId) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {
      // Analytics is optional when measurementId is not configured
    });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on application boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// In-memory ID token storage (never stored in localStorage)
let inMemoryIdToken: string | null = null;

export async function getInMemoryAuthToken(): Promise<string | null> {
  if (auth.currentUser) {
    inMemoryIdToken = await auth.currentUser.getIdToken();
    return inMemoryIdToken;
  }
  return inMemoryIdToken;
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  inMemoryIdToken = await result.user.getIdToken();
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  inMemoryIdToken = null;
  await signOut(auth);
}

export { onAuthStateChanged };
export type { User };

/**
 * Sanitizes a project ID to strictly adhere to firebase-blueprint.json & firestore.rules (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
 */
export function sanitizeFirestoreProjectId(rawId: string): string {
  const cleaned = String(rawId || 'proj_default')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || 'proj_default';
}

/**
 * Syncs a DramaProject metadata document to `/drama_projects/{projectId}` adhering strictly
 * to `firebase-blueprint.json` volumetric and structural constraints.
 */
export async function syncDramaProjectToFirestore(project: DramaProject): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Kailangang mag-sign in sa Google (Firebase Auth) bago mag-sync sa Cloud Firestore.');
  }

  const docId = sanitizeFirestoreProjectId(project.id);
  const path = `drama_projects/${docId}`;
  const docRef = doc(db, 'drama_projects', docId);

  try {
    const existingSnap = await getDoc(docRef);
    const totalDurationSec = Math.min(
      3600,
      Math.max(1, Math.round(calculateTotalTimelineDuration(project.scenes)))
    );
    const sceneCount = Math.min(100, Math.max(1, project.scenes.length));

    const payload = {
      ownerId: currentUser.uid.slice(0, 128),
      title: (project.title || 'Untitled Drama').trim().slice(0, 120) || 'Untitled Drama',
      prompt: (project.prompt || 'Dramatic scene').trim().slice(0, 2000) || 'Dramatic scene',
      genre: (project.genre || 'Drama').trim().slice(0, 80) || 'Drama',
      status: ['Draft', 'Generating', 'Done'].includes(project.status) ? project.status : 'Draft',
      characterName:
        (project.characterProfile.name || 'Protagonist').trim().slice(0, 100) || 'Protagonist',
      characterAppearance:
        (project.characterProfile.appearance || 'Consistent look').trim().slice(0, 500) ||
        'Consistent look',
      characterStyle:
        (project.characterProfile.style || 'Cinematic').trim().slice(0, 200) || 'Cinematic',
      selectedEffect: (project.selectedEffect || 'none').trim().slice(0, 64) || 'none',
      resolution: ['480p', '720p', '1080p'].includes(project.resolution)
        ? project.resolution
        : '720p',
      includeAudio: Boolean(project.includeAudio),
      sceneCount,
      totalDurationSec,
      createdAt: existingSnap.exists() ? existingSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(docRef, payload);

    const token = await getInMemoryAuthToken();
    if (token) {
      await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectKey: docId,
          title: payload.title,
          prompt: payload.prompt,
          genre: payload.genre,
          status: payload.status,
          characterName: payload.characterName,
          characterAppearance: payload.characterAppearance,
          characterStyle: payload.characterStyle,
          selectedEffect: payload.selectedEffect,
          resolution: payload.resolution,
          sceneCount: payload.sceneCount,
          totalDurationSec: payload.totalDurationSec,
        }),
      }).catch(() => {});
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteDramaProjectFromFirestore(projectId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  const docId = sanitizeFirestoreProjectId(projectId);
  const path = `drama_projects/${docId}`;
  try {
    await deleteDoc(doc(db, 'drama_projects', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface CloudDramaProjectSummary {
  id: string;
  ownerId: string;
  title: string;
  prompt: string;
  genre: string;
  status: 'Draft' | 'Generating' | 'Done';
  characterName: string;
  characterAppearance: string;
  characterStyle: string;
  selectedEffect: string;
  resolution: '480p' | '720p' | '1080p';
  includeAudio: boolean;
  sceneCount: number;
  totalDurationSec: number;
}

export function subscribeUserDramaProjects(
  userId: string,
  onProjects: (items: CloudDramaProjectSummary[]) => void,
  onErrorCallback?: (err: Error) => void
): () => void {
  const path = 'drama_projects';
  const q = query(collection(db, path), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: CloudDramaProjectSummary[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          ownerId: String(d.ownerId || ''),
          title: String(d.title || 'Untitled'),
          prompt: String(d.prompt || ''),
          genre: String(d.genre || 'Drama'),
          status: (d.status as 'Draft' | 'Generating' | 'Done') || 'Draft',
          characterName: String(d.characterName || ''),
          characterAppearance: String(d.characterAppearance || ''),
          characterStyle: String(d.characterStyle || ''),
          selectedEffect: String(d.selectedEffect || 'none'),
          resolution: (d.resolution as '480p' | '720p' | '1080p') || '720p',
          includeAudio: Boolean(d.includeAudio),
          sceneCount: Number(d.sceneCount || 1),
          totalDurationSec: Number(d.totalDurationSec || 5),
        });
      });
      onProjects(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (formattedErr: any) {
        if (onErrorCallback) onErrorCallback(formattedErr);
      }
    }
  );
}

// ============================================================================
// CLOUDFLARE R2 MEDIA ASSET METADATA IN FIRESTORE (/r2_media_assets/{assetId})
// Stores ONLY the file URL (/media/:key) and metadata — NEVER raw base64/blobs
// ============================================================================

export type R2MediaCategory = 'image' | 'video' | 'music';

export interface R2MediaAssetMetadata {
  id: string;
  ownerId: string;
  projectId: string;
  r2Key: string;
  bucket: 'movie-city-media';
  url: string;
  mediaType: R2MediaCategory;
  prompt: string;
  contentType: string;
  sizeBytes: number;
  model: string;
  createdAtIso: string;
  firestoreClientError?: string | null;
}

/**
 * Saves ONLY the R2 file URL and lightweight metadata to `/r2_media_assets/{assetId}` in Firestore.
 * Rejects `data:` base64 strings so binary media is never stored in Firestore.
 */
export async function saveR2MediaMetadataToFirestore(input: {
  id?: string;
  ownerId?: string;
  projectId?: string;
  r2Key: string;
  url: string;
  mediaType: R2MediaCategory;
  prompt: string;
  contentType: string;
  sizeBytes: number;
  model?: string;
}): Promise<R2MediaAssetMetadata> {
  const cleanUrl = String(input.url || '').trim();
  if (!cleanUrl || cleanUrl.startsWith('data:')) {
    throw new Error(
      'Invalid R2 URL for Firestore: Only the Worker R2 file URL (/media/:key) may be stored in Firestore, never raw base64 data.'
    );
  }

  const docId = sanitizeFirestoreProjectId(
    input.id || `r2_${input.mediaType}_${Date.now()}`
  );
  const ownerId = sanitizeFirestoreProjectId(
    auth.currentUser?.uid || input.ownerId || 'studio_e2e_user'
  );
  const projectId = sanitizeFirestoreProjectId(input.projectId || 'proj_default_1');
  const r2Key = String(input.r2Key || `${input.mediaType}/${docId}`).trim().slice(0, 256);
  const prompt = (String(input.prompt || 'Generated media').trim() || 'Generated media').slice(
    0,
    2000
  );
  const contentType = (
    String(input.contentType || 'image/png').trim() || 'image/png'
  ).slice(0, 120);
  const sizeBytes = Math.min(524288000, Math.max(1, Math.round(Number(input.sizeBytes) || 1)));
  const model = (String(input.model || 'gemini-2.5-flash-image-preview').trim() || 'gemini').slice(
    0,
    120
  );
  const mediaType: R2MediaCategory = ['image', 'video', 'music'].includes(input.mediaType)
    ? input.mediaType
    : 'image';
  const createdAtIso = new Date().toISOString();

  const path = `r2_media_assets/${docId}`;
  const docRef = doc(db, 'r2_media_assets', docId);
  let firestoreClientError: string | null = null;

  if (auth.currentUser) {
    try {
      await setDoc(docRef, {
        ownerId,
        projectId,
        r2Key,
        bucket: 'movie-city-media',
        url: cleanUrl.slice(0, 1024),
        mediaType,
        prompt,
        contentType,
        sizeBytes,
        model,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.CREATE, path);
      } catch (formattedErr: any) {
        firestoreClientError = formattedErr?.message || String(error);
      }
    }
  }

  const metadataRecord: R2MediaAssetMetadata = {
    id: docId,
    ownerId,
    projectId,
    r2Key,
    bucket: 'movie-city-media',
    url: cleanUrl.slice(0, 1024),
    mediaType,
    prompt,
    contentType,
    sizeBytes,
    model,
    createdAtIso,
    firestoreClientError,
  };

  try {
    await fetch('/api/cloudflare/r2/firestore-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadataRecord),
    });
  } catch {}

  return metadataRecord;
}

/**
 * Loads a saved R2 media metadata document from Cloud Firestore (`/r2_media_assets/{assetId}`).
 */
export async function loadR2MediaMetadataFromFirestore(
  assetId: string
): Promise<R2MediaAssetMetadata | null> {
  const docId = sanitizeFirestoreProjectId(assetId);
  const path = `r2_media_assets/${docId}`;
  const docRef = doc(db, 'r2_media_assets', docId);
  let firestoreClientError: string | null = null;

  if (auth.currentUser) {
    try {
      let snap;
      try {
        snap = await getDocFromServer(docRef);
      } catch {
        snap = await getDoc(docRef);
      }

      if (snap.exists()) {
        const d = snap.data();
        const createdAtIso =
          d.createdAt && typeof d.createdAt.toDate === 'function'
            ? d.createdAt.toDate().toISOString()
            : new Date().toISOString();

        return {
          id: snap.id,
          ownerId: String(d.ownerId || 'studio_e2e_user'),
          projectId: String(d.projectId || 'proj_default_1'),
          r2Key: String(d.r2Key || ''),
          bucket: 'movie-city-media',
          url: String(d.url || ''),
          mediaType: (['image', 'video', 'music'].includes(d.mediaType)
            ? d.mediaType
            : 'image') as R2MediaCategory,
          prompt: String(d.prompt || ''),
          contentType: String(d.contentType || 'image/png'),
          sizeBytes: Number(d.sizeBytes || 0),
          model: String(d.model || ''),
          createdAtIso,
          firestoreClientError: null,
        };
      }
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (formattedErr: any) {
        firestoreClientError = formattedErr?.message || String(error);
      }
    }
  }

  try {
    const resp = await fetch(
      `/api/cloudflare/r2/firestore-metadata/${encodeURIComponent(docId)}`
    );
    const data: any = await resp.json();
    if (resp.ok && data?.ok && data?.doc) {
      return {
        ...data.doc,
        firestoreClientError:
          firestoreClientError || data.doc.firestoreClientError || null,
      };
    }
  } catch {}

  return null;
}

/**
 * Lists R2 media asset metadata records from Cloud Firestore (`/r2_media_assets`)
 * merged with the server's verified R2 bucket metadata mirror (`/api/cloudflare/r2/firestore-metadata`).
 */
export async function listR2MediaMetadataFromFirestore(): Promise<R2MediaAssetMetadata[]> {
  const path = 'r2_media_assets';
  const mergedByKey = new Map<string, R2MediaAssetMetadata>();

  // 1. Always fetch verified R2 assets from server mirror first (includes video_akzyon_episode1.mp4, image_clara_manila_noir.png, test_success.png)
  try {
    const resp = await fetch('/api/cloudflare/r2/firestore-metadata');
    const data: any = await resp.json();
    if (resp.ok && Array.isArray(data?.items)) {
      for (const item of data.items as R2MediaAssetMetadata[]) {
        if (item && item.url) {
          const key = item.r2Key || item.url;
          mergedByKey.set(key, item);
        }
      }
    }
  } catch {}

  // 2. When authenticated, also query Cloud Firestore and merge
  if (auth.currentUser) {
    try {
      const q = query(collection(db, path), where('bucket', '==', 'movie-city-media'));
      const snap = await getDocs(q);
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const createdAtIso =
          d.createdAt && typeof d.createdAt.toDate === 'function'
            ? d.createdAt.toDate().toISOString()
            : new Date().toISOString();
        const r2Key = String(d.r2Key || '').trim();
        const rawUrl = String(d.url || (r2Key ? `/media/${r2Key}` : '')).trim();
        if (!rawUrl) return;
        const item: R2MediaAssetMetadata = {
          id: docSnap.id,
          ownerId: String(d.ownerId || auth.currentUser?.uid || 'studio_e2e_user'),
          projectId: String(d.projectId || 'proj_default_1'),
          r2Key: r2Key || rawUrl.replace(/^\/media\//, ''),
          bucket: 'movie-city-media',
          url: rawUrl.startsWith('/media/') ? rawUrl : `/media/${rawUrl.replace(/^\/+/, '')}`,
          mediaType: (['image', 'video', 'music'].includes(d.mediaType)
            ? d.mediaType
            : rawUrl.endsWith('.mp4')
            ? 'video'
            : 'image') as R2MediaCategory,
          prompt: String(d.prompt || 'Verified R2 Media Asset'),
          contentType: String(
            d.contentType || (rawUrl.endsWith('.mp4') ? 'video/mp4' : 'image/png')
          ),
          sizeBytes: Math.max(1, Number(d.sizeBytes || 108000)),
          model: String(d.model || 'gemini-3.1-flash-lite-image'),
          createdAtIso,
        };
        const dedupKey = item.r2Key || item.url;
        if (!mergedByKey.has(dedupKey)) {
          mergedByKey.set(dedupKey, item);
        }
      });
    } catch {
      // Fallback to server-backed Firestore metadata mirror when unauthenticated
    }
  }

  const allItems = Array.from(mergedByKey.values());
  allItems.sort(
    (a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime()
  );
  return allItems;
}


