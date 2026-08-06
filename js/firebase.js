// Firebase init + the full data layer, ported from src/lib/{firebase,
// marketplace,chat,admin,community,user-profile,site-settings}.ts.
// One file, flat namespaces (Auth/Profile/Products/Sourcing/Ads/Chat/Admin/
// Favorites/Comments/Reviews/Reports/SiteSettings) since every function here
// is a thin Firestore/Auth call — splitting further buys nothing.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  initializeFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  increment,
  serverTimestamp,
  getCountFromServer,
  Timestamp,
  writeBatch,
  deleteField,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
const firebaseConfig = {
  apiKey: "AIzaSyDxum9DYcroSdHuXWoeCZvfJ1N5tH9WN0g",
  authDomain: "waraqat-shajar.firebaseapp.com",
  projectId: "waraqat-shajar",
  storageBucket: "waraqat-shajar.firebasestorage.app",
  messagingSenderId: "931782671707",
  appId: "1:931782671707:web:56af19fcb31cdf9f652e7e",
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
// ignoreUndefinedProperties: this is a hand-written JS app (no static typing),
// so optional object fields are often built as `value || undefined` — plain
// getFirestore() throws "invalid-argument" the moment such a field is written.
export const db = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });

// ===========================================================================
// Storage (device file uploads)
// ===========================================================================
// Firebase Storage needs the Blaze billing plan to function at all, so image
// uploads go to Cloudinary's free tier instead — direct browser upload via an
// unsigned preset, no server/API secret involved. `path` (e.g. "ads/123-x.jpg")
// becomes the Cloudinary folder, matching the old Storage path layout.
const CLOUDINARY_CLOUD_NAME = "qyz52hze";
const CLOUDINARY_UPLOAD_PRESET = "waraqat_shajar";

export const Storage = {
  async uploadFile(path, file) {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (folder) formData.append("folder", folder);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || "Upload failed");
    }
    const data = await res.json();
    return data.secure_url;
  },

  // Voice notes come from MediaRecorder as a Blob (no filename), and audio
  // isn't a valid file for Cloudinary's /image/upload endpoint -- /auto/upload
  // lets Cloudinary detect the real resource type instead of hardcoding
  // /video/upload (where Cloudinary files audio-only clips).
  async uploadAudio(path, blob) {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
    const formData = new FormData();
    formData.append("file", blob, "voice-note.webm");
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (folder) formData.append("folder", folder);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || "Upload failed");
    }
    const data = await res.json();
    return data.secure_url;
  },

  // National ID photos are encrypted client-side before this ever runs (see
  // Crypto/IdentityVerification below), so the bytes are opaque ciphertext,
  // not a real image -- /image/upload would reject it. /raw/upload stores it
  // as an arbitrary binary asset instead.
  async uploadEncryptedFile(path, blob) {
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
    const formData = new FormData();
    // The upload preset's allowed-formats list rejects a plain ".bin"
    // extension -- ".dat" passes through fine and reads clearly as opaque
    // data if anyone ever stumbles on the URL directly.
    formData.append("file", blob, "encrypted.dat");
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (folder) formData.append("folder", folder);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || "Upload failed");
    }
    const data = await res.json();
    return data.secure_url;
  },
};

// ===========================================================================
// Client-side encryption (National ID photos)
// ===========================================================================
// This is a static site with no server, so a Cloudinary URL alone is public
// to anyone who has it (same as every other image on the site). A National
// ID card photo is far more sensitive than a product photo, so instead of
// uploading it in the clear, we encrypt it in the browser with a per-photo
// AES-GCM key before it ever leaves the device. The key + IV travel with the
// Firestore record (identityVerification/{uid}), which has its own narrow
// read rule (owner, or an admin explicitly granted the "identity" section) --
// see firestore.rules. Anyone who only has the Cloudinary URL sees ciphertext.
const AES_ALGO = "AES-GCM";

function bufToBase64(buf) {
  let binary = "";
  new Uint8Array(buf).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const Crypto = {
  // Encrypts `file` with a freshly generated random key + IV (never reused
  // across uploads). Returns the ciphertext as a Blob ready to upload, plus
  // the key/IV/original mime type as base64/plain strings ready to store in
  // Firestore alongside the uploaded URL.
  async encryptFile(file) {
    const key = await crypto.subtle.generateKey({ name: AES_ALGO, length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plainBuf = await file.arrayBuffer();
    const cipherBuf = await crypto.subtle.encrypt({ name: AES_ALGO, iv }, key, plainBuf);
    const rawKey = await crypto.subtle.exportKey("raw", key);
    return {
      blob: new Blob([cipherBuf], { type: "application/octet-stream" }),
      keyB64: bufToBase64(rawKey),
      ivB64: bufToBase64(iv.buffer),
      mimeType: file.type || "image/jpeg",
    };
  },

  // Fetches the ciphertext back from its (public, but meaningless without
  // the key) URL and decrypts it in-browser. Returns an object URL suitable
  // for an <img src>, which the caller should revoke when done with it.
  async decryptToObjectUrl({ url, keyB64, ivB64, mimeType }) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch encrypted file");
    const cipherBuf = await res.arrayBuffer();
    const key = await crypto.subtle.importKey("raw", base64ToBuf(keyB64), AES_ALGO, false, ["decrypt"]);
    const iv = new Uint8Array(base64ToBuf(ivB64));
    const plainBuf = await crypto.subtle.decrypt({ name: AES_ALGO, iv }, key, cipherBuf);
    return URL.createObjectURL(new Blob([plainBuf], { type: mimeType || "image/jpeg" }));
  },
};

// ===========================================================================
// Auth
// ===========================================================================
const googleProvider = new GoogleAuthProvider();

export const Auth = {
  onChange(callback) {
    return onAuthStateChanged(auth, callback);
  },

  async registerWithEmail(fullName, email, password) {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: fullName });
    return credential.user;
  },

  async signInWithEmail(email, password) {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  },

  // Popups get silently blocked by some mobile browsers/in-app webviews, so
  // fall back to a full-page redirect flow there; completeGoogleRedirect()
  // below picks the result back up once the page reloads after redirecting.
  async signInWithGoogle() {
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      return { user: credential.user, redirected: false };
    } catch (error) {
      if (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, googleProvider);
        return { user: null, redirected: true };
      }
      throw error;
    }
  },

  async completeGoogleRedirect() {
    const credential = await getRedirectResult(auth);
    return credential ? credential.user : null;
  },

  async signOutUser() {
    await signOut(auth);
  },

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  },

  getAuthErrorKey(error) {
    const code = error?.code ?? "";
    switch (code) {
      case "auth/invalid-email":
        return "invalidEmail";
      case "auth/weak-password":
        return "weakPassword";
      case "auth/email-already-in-use":
        return "emailInUse";
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "wrongCredentials";
      case "auth/unauthorized-domain":
        return "unauthorizedDomain";
      case "auth/popup-blocked":
        return "popupBlocked";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "popupClosed";
      case "auth/account-exists-with-different-credential":
        return "accountExistsDifferentCredential";
      default:
        return "generic";
    }
  },
};

// ===========================================================================
// User profile (users/{uid})
// ===========================================================================
function userDocRef(uid) {
  return doc(db, "users", uid);
}

export const Profile = {
  async createUserProfile(input) {
    await setDoc(userDocRef(input.uid), {
      uid: input.uid,
      fullName: input.fullName,
      phone: input.phone,
      governorate: input.governorate,
      accountType: input.accountType,
      crops: input.crops ?? [],
      sourcingCategories: input.sourcingCategories ?? [],
      email: input.email,
      photoURL: input.photoURL,
      authProvider: input.authProvider,
      termsAcceptedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      ratingAverage: 0,
      ratingCount: 0,
      status: "active",
      suspendedUntil: null,
      violationCount: 0,
    });
    if (input.accountType === "farmer") {
      SiteSettings.incrementRegisteredFarmers().catch(() => {});
    }
  },

  async getUserProfile(uid) {
    const snap = await getDoc(userDocRef(uid));
    return snap.exists() ? snap.data() : null;
  },

  subscribeUserProfile(uid, callback) {
    return onSnapshot(userDocRef(uid), (snap) => callback(snap.exists() ? snap.data() : null));
  },

  // photoURL is a protected field in firestore.rules -- only the owner
  // account can actually write it, enforced server-side regardless of
  // who calls this.
  async updatePhotoURL(uid, photoURL) {
    await updateDoc(userDocRef(uid), { photoURL });
  },

  // Called every time a user's own client blocks a phone-number-sharing
  // attempt. Every 3rd strike self-suspends the account for 24h — see the
  // matching firestore.rules carve-out that allows only this exact
  // active->suspended (and, separately, the expiry self-heal below) transition.
  async recordViolation(uid) {
    const ref = userDocRef(uid);
    await updateDoc(ref, { violationCount: increment(1) });
    const snap = await getDoc(ref);
    const count = snap.data()?.violationCount ?? 0;
    if (count > 0 && count % 3 === 0) {
      await updateDoc(ref, {
        status: "suspended",
        suspendedUntil: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      });
    }
  },

  async clearExpiredSuspension(uid) {
    await updateDoc(userDocRef(uid), { status: "active", suspendedUntil: null });
  },
};

// ===========================================================================
// Identity verification (National ID number + encrypted ID card photo)
// ===========================================================================
// Deliberately its own top-level doc, not fields on users/{uid} -- that doc's
// read rule already lets ANY admin read it (see firestore.rules), which is
// far broader than what the owner wants for something this sensitive. This
// collection has its own read rule: the user themselves, the owner, or an
// admin explicitly granted "identity" in allowedSections.
function identityDocRef(uid) {
  return doc(db, "identityVerification", uid);
}

export const IdentityVerification = {
  // file is the raw File from an <input type="file">; encrypted client-side
  // (see Crypto.encryptFile) before it ever reaches Cloudinary.
  async submit(uid, { nationalId, file }) {
    const { blob, keyB64, ivB64, mimeType } = await Crypto.encryptFile(file);
    const url = await Storage.uploadEncryptedFile(`identity/${uid}-${Date.now()}`, blob);
    await setDoc(identityDocRef(uid), {
      nationalId,
      idCardPhotoUrl: url,
      idCardPhotoKey: keyB64,
      idCardPhotoIv: ivB64,
      idCardPhotoMimeType: mimeType,
      submittedAt: serverTimestamp(),
    });
  },

  async getForUser(uid) {
    const snap = await getDoc(identityDocRef(uid));
    return snap.exists() ? snap.data() : null;
  },

  // Convenience wrapper around Crypto.decryptToObjectUrl for a stored record.
  async decryptPhoto(record) {
    return Crypto.decryptToObjectUrl({
      url: record.idCardPhotoUrl,
      keyB64: record.idCardPhotoKey,
      ivB64: record.idCardPhotoIv,
      mimeType: record.idCardPhotoMimeType,
    });
  },
};

// ===========================================================================
// Products
// ===========================================================================
const productsCol = collection(db, "products");

export const Products = {
  newProductId() {
    return doc(productsCol).id;
  },

  async createProduct(id, input) {
    await setDoc(doc(productsCol, id), {
      ...input,
      status: "active",
      viewsCount: 0,
      offersCount: 0,
      dealsCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  },

  async updateProduct(id, patch) {
    await updateDoc(doc(db, "products", id), { ...patch, updatedAt: serverTimestamp() });
  },

  async setProductStatus(id, status) {
    await updateDoc(doc(db, "products", id), { status, updatedAt: serverTimestamp() });
  },

  async deleteProduct(id) {
    await deleteDoc(doc(db, "products", id));
  },

  async getProduct(id) {
    const snap = await getDoc(doc(db, "products", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  subscribeMyProducts(ownerId, callback) {
    const q = query(productsCol, where("ownerId", "==", ownerId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  async listActiveProducts(filters = {}) {
    const constraints = [where("status", "==", "active")];
    if (filters.category) constraints.push(where("category", "==", filters.category));
    if (filters.governorate) constraints.push(where("governorate", "==", filters.governorate));
    constraints.push(orderBy("createdAt", "desc"));
    if (filters.limitCount) constraints.push(limit(filters.limitCount));
    const snap = await getDocs(query(productsCol, ...constraints));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async incrementProductViews(id) {
    await updateDoc(doc(db, "products", id), { viewsCount: increment(1) });
  },

  async incrementProductOffers(id) {
    await updateDoc(doc(db, "products", id), { offersCount: increment(1) });
  },

  async incrementProductDeals(id) {
    await updateDoc(doc(db, "products", id), { dealsCount: increment(1) });
  },

  async countActive() {
    const snap = await getCountFromServer(query(productsCol, where("status", "==", "active")));
    return snap.data().count;
  },
};

// ===========================================================================
// Sourcing requests
// ===========================================================================
const sourcingCol = collection(db, "sourcingRequests");

export const Sourcing = {
  async createSourcingRequest(input) {
    await addDoc(sourcingCol, { ...input, status: "open", createdAt: serverTimestamp() });
  },

  async closeSourcingRequest(id) {
    await updateDoc(doc(db, "sourcingRequests", id), { status: "closed" });
  },

  async deleteSourcingRequest(id) {
    await deleteDoc(doc(db, "sourcingRequests", id));
  },

  subscribeMySourcingRequests(ownerId, callback) {
    const q = query(sourcingCol, where("ownerId", "==", ownerId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  async listMatchingSourcingRequests(crops, governorate) {
    if (crops.length === 0) return [];
    const q = query(
      sourcingCol,
      where("status", "==", "open"),
      where("category", "in", crops.slice(0, 10)),
      where("governorates", "array-contains", governorate),
      orderBy("createdAt", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

// ===========================================================================
// Ads
// ===========================================================================
const adsCol = collection(db, "ads");

export const Ads = {
  async createAd(input) {
    await addDoc(adsCol, { ...input, createdAt: serverTimestamp() });
  },

  async updateAd(id, patch) {
    await updateDoc(doc(db, "ads", id), patch);
  },

  async deleteAd(id) {
    await deleteDoc(doc(db, "ads", id));
  },

  async listAllAds() {
    const snap = await getDocs(query(adsCol, orderBy("order", "asc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listActiveAdsByPlacement(placement) {
    const snap = await getDocs(
      query(adsCol, where("placement", "==", placement), where("active", "==", true)),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.order - b.order);
  },
};

// ===========================================================================
// Chat
// ===========================================================================
const chatsCol = collection(db, "chats");

export const Chat = {
  async findOrCreateChat(params) {
    const q = query(
      chatsCol,
      where("participantIds", "array-contains", params.currentUid),
      where("contextId", "==", params.contextId),
    );
    const snap = await getDocs(q);
    const existing = snap.docs.find((d) => d.data().participantIds.includes(params.otherUid));
    if (existing) return existing.id;

    const docRef = await addDoc(chatsCol, {
      participantIds: [params.currentUid, params.otherUid],
      participantNames: {
        [params.currentUid]: params.currentName,
        [params.otherUid]: params.otherName,
      },
      participantPhones: {
        [params.currentUid]: params.currentPhone,
        [params.otherUid]: params.otherPhone,
      },
      contextType: params.contextType,
      contextId: params.contextId,
      contextLabel: params.contextLabel,
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  },

  async getChat(chatId) {
    const snap = await getDoc(doc(db, "chats", chatId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  subscribeMyChats(uid, callback) {
    const q = query(chatsCol, where("participantIds", "array-contains", uid), orderBy("lastMessageAt", "desc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  subscribeChatMessages(chatId, callback) {
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  async sendTextMessage(chatId, senderId, text) {
    await addDoc(collection(db, "chats", chatId, "messages"), {
      senderId,
      type: "text",
      text,
      offer: null,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "chats", chatId), { lastMessage: text, lastMessageAt: serverTimestamp() });
  },

  async sendOfferMessage(chatId, senderId, offer) {
    await addDoc(collection(db, "chats", chatId, "messages"), {
      senderId,
      type: "offer",
      text: null,
      offer: { ...offer, status: "pending" },
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `${offer.pricePerUnit} / ${offer.unit}`,
      lastMessageAt: serverTimestamp(),
    });
  },

  async respondToOffer(chatId, messageId, status) {
    await updateDoc(doc(db, "chats", chatId, "messages", messageId), { "offer.status": status });
  },

  async listIncomingOffers(farmerUid) {
    const chatsSnap = await getDocs(query(chatsCol, where("participantIds", "array-contains", farmerUid)));
    const productChats = chatsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.contextType === "product");

    const perChat = await Promise.all(
      productChats.map(async (chat) => {
        const buyerUid = chat.participantIds.find((id) => id !== farmerUid);
        if (!buyerUid) return [];
        const messagesSnap = await getDocs(
          query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt", "desc")),
        );
        return messagesSnap.docs
          .filter((m) => m.data().type === "offer" && m.data().senderId === buyerUid)
          .map((m) => {
            const data = m.data();
            return {
              ...data.offer,
              chatId: chat.id,
              messageId: m.id,
              productId: chat.contextId,
              productLabel: chat.contextLabel,
              buyerId: buyerUid,
              buyerName: chat.participantNames[buyerUid],
              buyerPhone: chat.participantPhones[buyerUid],
              createdAt: data.createdAt ?? null,
            };
          });
      }),
    );

    return perChat.flat().sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  },

  // The buyer-side mirror of listIncomingOffers — every offer a buyer has
  // sent across all their product chats, regardless of which farmer it went to.
  async listMyOffers(buyerUid) {
    const chatsSnap = await getDocs(query(chatsCol, where("participantIds", "array-contains", buyerUid)));
    const productChats = chatsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.contextType === "product");

    const perChat = await Promise.all(
      productChats.map(async (chat) => {
        const farmerUid = chat.participantIds.find((id) => id !== buyerUid);
        if (!farmerUid) return [];
        const messagesSnap = await getDocs(
          query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt", "desc")),
        );
        return messagesSnap.docs
          .filter((m) => m.data().type === "offer" && m.data().senderId === buyerUid)
          .map((m) => {
            const data = m.data();
            return {
              ...data.offer,
              chatId: chat.id,
              messageId: m.id,
              productId: chat.contextId,
              productLabel: chat.contextLabel,
              farmerUid,
              farmerName: chat.participantNames[farmerUid],
              createdAt: data.createdAt ?? null,
            };
          });
      }),
    );

    return perChat.flat().sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  },

  // Admin-only: every chat, for the moderation/oversight view. Just browsing
  // a conversation stays invisible to its participants (read-only) — the one
  // deliberate exception is lockChat() below, a visible moderation action.
  async listAllChats() {
    const snap = await getDocs(query(chatsCol, orderBy("lastMessageAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  // Admin-only "Stop Conversation": blocks further messages from the two
  // participants (enforced in firestore.rules) and posts a visible system
  // warning so both sides know why. Deleting the chat afterwards, if needed,
  // already goes through the existing admin-only chats delete rule.
  async lockChat(chatId) {
    await updateDoc(doc(db, "chats", chatId), { locked: true });
    await addDoc(collection(db, "chats", chatId, "messages"), {
      senderId: "system",
      type: "system",
      systemKey: "chat.systemLockedWarning",
      text: null,
      offer: null,
      createdAt: serverTimestamp(),
    });
  },
};

// ===========================================================================
// Escrow order tracker — one doc per accepted chat offer (doc id == the
// offer message's own id), a manually-attested state machine loosely
// modelled on a real escrow flow (see the payment-system guide the owner
// provided): awaiting_payment -> payment_claimed -> payment_confirmed ->
// delivery_confirmed -> released, with a disputed branch resolved by the
// owner. IMPORTANT: this project has no payment gateway or backend, so
// nothing here actually holds or moves money -- every status is a
// self-reported attestation (the buyer says "I paid", the owner confirms
// they really received it against settings/paymentInfo, the buyer confirms
// delivery). The value this adds is state-machine discipline (illegal
// jumps rejected by firestore.rules) and an immutable audit trail, not
// payment verification.
// ===========================================================================
const escrowOrdersCol = collection(db, "escrowOrders");

export const Escrow = {
  async createOrder({ orderId, chatId, productId, productLabel, buyerId, buyerName, sellerId, sellerName, quantity, unit, pricePerUnit }) {
    await setDoc(doc(db, "escrowOrders", orderId), {
      chatId,
      productId,
      productLabel: productLabel || null,
      buyerId,
      buyerName,
      sellerId,
      sellerName,
      quantity,
      unit,
      pricePerUnit,
      totalAmount: quantity * pricePerUnit,
      status: "awaiting_payment",
      paymentClaimedAt: null,
      paymentConfirmedAt: null,
      deliveryConfirmedAt: null,
      disputedAt: null,
      disputedBy: null,
      disputeNote: null,
      releasedAt: null,
      refundedAt: null,
      createdAt: serverTimestamp(),
    });
  },

  async getOrderOnce(orderId) {
    const snap = await getDoc(doc(db, "escrowOrders", orderId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  subscribeOrder(orderId, callback) {
    return onSnapshot(
      doc(db, "escrowOrders", orderId),
      (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => callback(null),
    );
  },

  // phoneNumber + referenceNumber + proofUrl are all required by
  // firestore.rules (not just the UI) -- a bare status claim with no
  // evidence isn't enough for the owner/granted admin to actually verify a
  // transfer happened. phoneNumber is the number the buyer paid FROM (e.g.
  // their Vodafone Cash number), which the seller needs to match the
  // transfer in their own transaction history.
  async markPaymentClaimed(orderId, { method, phoneNumber, referenceNumber, proofUrl }) {
    await updateDoc(doc(db, "escrowOrders", orderId), {
      status: "payment_claimed",
      paymentClaimedAt: serverTimestamp(),
      paymentMethodChosen: method || null,
      paymentPhoneNumber: phoneNumber,
      paymentReferenceNumber: referenceNumber,
      paymentProofUrl: proofUrl,
    });
  },

  // Owner-only in firestore.rules -- confirms a real transfer was received
  // against the owner's own settings/paymentInfo details.
  async confirmPaymentReceived(orderId) {
    await updateDoc(doc(db, "escrowOrders", orderId), { status: "payment_confirmed", paymentConfirmedAt: serverTimestamp() });
  },

  async confirmDelivery(orderId) {
    await updateDoc(doc(db, "escrowOrders", orderId), { status: "delivery_confirmed", deliveryConfirmedAt: serverTimestamp() });
  },

  async raiseDispute(orderId, uid, note) {
    await updateDoc(doc(db, "escrowOrders", orderId), {
      status: "disputed",
      disputedAt: serverTimestamp(),
      disputedBy: uid,
      disputeNote: note,
    });
  },

  // Both owner-only in firestore.rules -- the owner physically pays the
  // farmer (or refunds the buyer) outside the app, then marks it here.
  async release(orderId) {
    await updateDoc(doc(db, "escrowOrders", orderId), { status: "released", releasedAt: serverTimestamp() });
  },

  async refund(orderId) {
    await updateDoc(doc(db, "escrowOrders", orderId), { status: "refunded", refundedAt: serverTimestamp() });
  },

  // Owner-only oversight list (admin-payments.js) -- fetched in full and
  // filtered client-side since the collection is expected to stay small.
  async listAllOnce() {
    const snap = await getDocs(escrowOrdersCol);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  // Every order a buyer has ever placed -- single equality filter (no
  // composite index needed, unlike buyerId+productId together), so
  // cart.js filters the small result by productId itself to find the one
  // relevant to each row.
  async listMyOrdersOnce(buyerId) {
    const q = query(escrowOrdersCol, where("buyerId", "==", buyerId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

// ===========================================================================
// Phone-attempt logging — a user's own client writes one of these whenever
// containsPhoneNumber() blocks their chat/comment submission, so admins can
// see who tried to share contact info, when, and with/on whom.
// ===========================================================================
const phoneAttemptsCol = collection(db, "phoneAttempts");

export const PhoneAttempts = {
  async logAttempt({ uid, name, context, contextId, targetName, snippet }) {
    await addDoc(phoneAttemptsCol, {
      uid,
      name,
      context,
      contextId,
      targetName: targetName ?? null,
      snippet,
      createdAt: serverTimestamp(),
    });
    await Profile.recordViolation(uid);
  },

  async listAll() {
    const snap = await getDocs(query(phoneAttemptsCol, orderBy("createdAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },
};

// ===========================================================================
// Favorites
// ===========================================================================
const favoritesCol = collection(db, "favorites");

function favoriteId(uid, productId) {
  return `${uid}_${productId}`;
}

export const Favorites = {
  async addFavorite(uid, productId) {
    await setDoc(doc(favoritesCol, favoriteId(uid, productId)), {
      uid,
      productId,
      createdAt: serverTimestamp(),
    });
  },

  async removeFavorite(uid, productId) {
    await deleteDoc(doc(favoritesCol, favoriteId(uid, productId)));
  },

  subscribeFavorites(uid, callback) {
    const q = query(favoritesCol, where("uid", "==", uid), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => callback([]),
    );
  },
};

// ===========================================================================
// Cart — same one-doc-per-(user,product) shape as Favorites, plus a
// quantity field the user can adjust from the cart page.
// ===========================================================================
const cartItemsCol = collection(db, "cartItems");

function cartItemId(uid, productId) {
  return `${uid}_${productId}`;
}

export const Cart = {
  async addToCart(uid, productId, quantity) {
    const ref = doc(cartItemsCol, cartItemId(uid, productId));
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { quantity });
    } else {
      await setDoc(ref, {
        uid,
        productId,
        quantity,
        addedAt: serverTimestamp(),
      });
    }
  },

  async updateCartQuantity(uid, productId, quantity) {
    await updateDoc(doc(cartItemsCol, cartItemId(uid, productId)), { quantity });
  },

  async removeFromCart(uid, productId) {
    await deleteDoc(doc(cartItemsCol, cartItemId(uid, productId)));
  },

  subscribeCart(uid, callback) {
    const q = query(cartItemsCol, where("uid", "==", uid), orderBy("addedAt", "desc"));
    return onSnapshot(
      q,
      (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => callback([]),
    );
  },
};

// ===========================================================================
// Product comments
// ===========================================================================
const commentsCol = collection(db, "productComments");

export const Comments = {
  async addProductComment(input) {
    await addDoc(commentsCol, { ...input, createdAt: serverTimestamp() });
  },

  async deleteProductComment(id) {
    await deleteDoc(doc(db, "productComments", id));
  },

  subscribeProductComments(productId, callback) {
    const q = query(commentsCol, where("productId", "==", productId), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => callback([]),
    );
  },
};

// ===========================================================================
// Reviews
// ===========================================================================
const reviewsCol = collection(db, "reviews");

export const Reviews = {
  async createReview(input) {
    await addDoc(reviewsCol, { ...input, createdAt: serverTimestamp() });
  },

  async getUserReviews(uid) {
    const q = query(reviewsCol, where("toUid", "==", uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async getUserRatingSummary(uid) {
    const reviews = await Reviews.getUserReviews(uid);
    if (reviews.length === 0) return { average: 0, count: 0 };
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    return { average: sum / reviews.length, count: reviews.length };
  },

  async hasReviewedChat(fromUid, chatId) {
    const q = query(reviewsCol, where("fromUid", "==", fromUid), where("chatId", "==", chatId));
    const snap = await getDocs(q);
    return !snap.empty;
  },
};

// ===========================================================================
// Reports
// ===========================================================================
const reportsCol = collection(db, "reports");

export const Reports = {
  async createReport(input) {
    await addDoc(reportsCol, { ...input, status: "pending", adminNotes: "", createdAt: serverTimestamp() });
  },

  async listAllReports() {
    const snap = await getDocs(query(reportsCol, orderBy("createdAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async updateReportStatus(id, status, adminNotes) {
    await updateDoc(doc(db, "reports", id), { status, adminNotes });
  },
};

// ===========================================================================
// Admin
// ===========================================================================
export const OWNER_EMAIL = "sgyiath@gmail.com";

// georgemagdy117@gmail.com and mostafahalafawy937@gmail.com deliberately
// show up as perfectly ordinary admins everywhere in the regular admin
// panel (see js/pages/admin-admins.js) -- any real emergency authority the
// owner holds over them only ever surfaces through Supreme Mode (see
// js/supreme-mode.js), never here. Only the owner's own admin doc is
// actually unrevokable by anyone, enforced in firestore.rules purely to
// prevent a self-lockout.

export const Admin = {
  async grantSelfAdmin(uid, email) {
    await setDoc(doc(db, "admins", uid), { email, grantedAt: serverTimestamp() });
  },

  // adminModeCode lives in its own adminSecrets/{uid} doc, readable only by
  // that admin (or the owner) -- NOT the admins/{uid} doc, which is read by
  // any signed-in client (e.g. the public "Contact Us" support-admin
  // picker). It used to sit on admins/{uid} itself, which meant its
  // plaintext value was returned to every visitor's network response the
  // moment listSupportAdmins() ran, regardless of what the UI chose to
  // display -- a real "excessive data exposure" bug, not just theoretical.
  async grantAdmin(uid, email, adminModeCode, allowedSections = null) {
    await setDoc(doc(db, "admins", uid), { email, grantedAt: serverTimestamp(), allowedSections });
    await setDoc(doc(db, "adminSecrets", uid), { adminModeCode });
  },

  // Owner-only in firestore.rules (isOwner() already covers any field on
  // any admin doc) -- lets the owner revise an existing admin's section
  // grants after the fact, not just at creation time.
  async updateAllowedSections(uid, allowedSections) {
    await updateDoc(doc(db, "admins", uid), { allowedSections });
  },

  async revokeAdmin(uid) {
    await deleteDoc(doc(db, "admins", uid));
    await deleteDoc(doc(db, "adminSecrets", uid)).catch(() => {});
  },

  async listAllAdmins() {
    const snap = await getDocs(collection(db, "admins"));
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },

  async setAdminModeCode(uid, code) {
    await setDoc(doc(db, "adminSecrets", uid), { adminModeCode: code }, { merge: true });
    // Clean up the old, insecurely-placed copy the first time this admin
    // rotates their code post-migration; harmless no-op once it's gone.
    await updateDoc(doc(db, "admins", uid), { adminModeCode: deleteField() }).catch(() => {});
  },

  // Owner-only in firestore.rules (adminSecrets/{uid} read: request.auth.uid
  // == uid || isOwner()) -- lets the owner see another admin's current
  // admin-mode PIN directly, not just blindly overwrite it.
  async getAdminModeCode(uid) {
    const snap = await getDoc(doc(db, "adminSecrets", uid));
    if (snap.exists() && snap.data().adminModeCode) return snap.data().adminModeCode;
    // Same old-location fallback as verifyAdminModeCode above.
    const oldSnap = await getDoc(doc(db, "admins", uid));
    return oldSnap.exists() ? oldSnap.data().adminModeCode || null : null;
  },

  // Support-chat opt-in: an admin who flips this on shows up as a pickable
  // contact on the public "Contact Us" page.
  async setAcceptingSupport(uid, accepting) {
    await updateDoc(doc(db, "admins", uid), { acceptingSupport: accepting });
  },

  async listSupportAdmins() {
    const snap = await getDocs(query(collection(db, "admins"), where("acceptingSupport", "==", true)));
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  },

  async verifyAdminModeCode(uid, code) {
    const snap = await getDoc(doc(db, "adminSecrets", uid));
    const stored = snap.exists() ? snap.data().adminModeCode : null;
    if (stored) return stored === code;
    // Fallback for any admin who hasn't rotated their code since the
    // adminSecrets migration -- reads the old (still-supported) location.
    const oldSnap = await getDoc(doc(db, "admins", uid));
    return oldSnap.exists() && Boolean(oldSnap.data().adminModeCode) && oldSnap.data().adminModeCode === code;
  },

  subscribeIsAdmin(uid, callback) {
    return onSnapshot(doc(db, "admins", uid), (snap) =>
      // allowedSections is null/undefined for admins granted before this
      // feature existed -- treated as "full access" (see admin-shell.js).
      callback(snap.exists(), snap.exists() ? snap.data().allowedSections ?? null : null),
    );
  },

  async listAllUsers() {
    const snap = await getDocs(collection(db, "users"));
    return snap.docs.map((d) => d.data());
  },

  async deleteUserAccount(uid) {
    await deleteDoc(doc(db, "users", uid));
    await Admin.revokeAdmin(uid).catch(() => {});
  },

  async setUserStatus(uid, status, suspendedDays) {
    await updateDoc(doc(db, "users", uid), {
      status,
      suspendedUntil:
        status === "suspended" && suspendedDays
          ? Timestamp.fromDate(new Date(Date.now() + suspendedDays * 24 * 60 * 60 * 1000))
          : null,
    });
  },

  async listAllProductsForAdmin() {
    const snap = await getDocs(collection(db, "products"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async removeListingAdmin(id) {
    await deleteDoc(doc(db, "products", id));
  },

  async listAllProductComments() {
    const snap = await getDocs(query(collection(db, "productComments"), orderBy("createdAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async removeProductCommentAdmin(id) {
    await deleteDoc(doc(db, "productComments", id));
  },

  async listMostActiveUsers(limitCount = 10) {
    const [users, products, sourcingRequests, comments, reviews] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "products")),
      getDocs(collection(db, "sourcingRequests")),
      getDocs(collection(db, "productComments")),
      getDocs(collection(db, "reviews")),
    ]);

    const scores = new Map();
    function add(uid, weight) {
      if (!uid) return;
      scores.set(uid, (scores.get(uid) ?? 0) + weight);
    }
    products.docs.forEach((d) => add(d.data().ownerId, 3));
    sourcingRequests.docs.forEach((d) => add(d.data().ownerId, 3));
    comments.docs.forEach((d) => add(d.data().uid, 1));
    reviews.docs.forEach((d) => add(d.data().fromUid, 1));

    const userList = users.docs.map((d) => d.data());
    return userList
      .map((u) => ({
        uid: u.uid,
        fullName: u.fullName,
        email: u.email,
        accountType: u.accountType,
        score: scores.get(u.uid) ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limitCount);
  },

  async listFarmerDealsRanking(limitCount = 10) {
    const snap = await getDocs(collection(db, "products"));
    const totals = new Map();
    snap.docs.forEach((d) => {
      const data = d.data();
      const current = totals.get(data.ownerId) ?? { fullName: data.ownerName, dealsCount: 0 };
      current.dealsCount += data.dealsCount ?? 0;
      totals.set(data.ownerId, current);
    });
    return Array.from(totals.entries())
      .map(([uid, v]) => ({ uid, fullName: v.fullName, dealsCount: v.dealsCount }))
      .sort((a, b) => b.dealsCount - a.dealsCount)
      .slice(0, limitCount);
  },

  async getPlatformAnalytics() {
    const usersSnap = await getDocs(collection(db, "users"));
    const users = usersSnap.docs.map((d) => d.data());
    const usersByRole = users.reduce((acc, u) => {
      acc[u.accountType] = (acc[u.accountType] ?? 0) + 1;
      return acc;
    }, {});

    const activeListingsSnap = await getCountFromServer(
      query(collection(db, "products"), where("status", "==", "active")),
    );
    const pendingReportsSnap = await getCountFromServer(
      query(collection(db, "reports"), where("status", "==", "pending")),
    );
    const commentsSnap = await getCountFromServer(collection(db, "productComments"));
    const adsSnap = await getCountFromServer(query(collection(db, "ads"), where("active", "==", true)));

    return {
      totalUsers: users.length,
      usersByRole,
      activeListings: activeListingsSnap.data().count,
      pendingReports: pendingReportsSnap.data().count,
      totalComments: commentsSnap.data().count,
      activeAds: adsSnap.data().count,
    };
  },
};

// ===========================================================================
// Site settings (settings/siteImages)
// ===========================================================================
const DEFAULT_SITE_IMAGES = {
  heroImages: ["images/hero-farmer.jpg"],
  categoryImages: {},
  logoUrl: null,
};
const siteImagesRef = doc(db, "settings", "siteImages");

const DEFAULT_SITE_CONTENT = { ar: {}, en: {} };
const siteContentRef = doc(db, "settings", "siteContent");

const DEFAULT_SITE_THEME = { primaryColor: null, cursorSize: null, cursorEffectDisabled: false, defaultDarkMode: false };
const siteThemeRef = doc(db, "settings", "siteTheme");

const DEFAULT_SOCIAL_LINKS = { links: [], phone: null, whatsapp: null, email: null, policyLink: null };
const socialLinksRef = doc(db, "settings", "socialLinks");

const DEFAULT_AD_PLACEMENTS = {};
const adPlacementsRef = doc(db, "settings", "adPlacements");

const DEFAULT_CATEGORIES_CONFIG = { extra: [], hidden: [] };
const categoriesConfigRef = doc(db, "settings", "categories");

// Real, publicly-readable counters for the homepage stats strip. Kept as a
// small standalone doc (instead of scanning the users/products collections
// live) because `users` reads are locked to self-or-admin, and summing
// dealsCount across every product client-side on every homepage load would
// be wasteful -- these are bumped by exactly 1 at the two real events they
// track, mirroring the existing "bump a counter by 1" rule pattern already
// used for products.viewsCount/offersCount/dealsCount.
const DEFAULT_PUBLIC_STATS = { registeredFarmers: 0, completedDeals: 0 };
const publicStatsRef = doc(db, "settings", "publicStats");

const killSwitchRef = doc(db, "settings", "killSwitch");

// Separate from killSwitch on purpose -- killSwitch is the owner
// deliberately locking the whole site behind a login-to-unlock screen;
// maintenanceMode is a softer "something's being fixed, come back soon"
// screen with no unlock form (the owner just flips it off from the admin
// panel), and it exempts signed-in admins so they can still reach that
// toggle. See js/layout.js for the overlay UI.
const maintenanceModeRef = doc(db, "settings", "maintenanceMode");

// Owner-only sitewide switch that blocks new messages in every regular
// (user-to-user/support) chat -- enforced in firestore.rules, not just the
// UI. Deliberately does NOT touch adminChats (the admin team-chat room),
// which is a separate collection entirely.
const chatDisabledRef = doc(db, "settings", "chatDisabled");

// The platform's payment-receiving methods -- a fully admin-managed list
// (add/remove/enable/disable any method, not a fixed set of fields), so the
// owner (or an admin granted "payments") has complete control over what
// shows up in the buyer-facing method picker. Each entry:
// { id, label, icon, value, enabled }. See firestore.rules for why this doc
// is write-restricted to isOwnerOrGranted('payments') (read is any signed-in
// user, since a buyer needs to see it to know where to send money).
const DEFAULT_PAYMENT_INFO = {
  methods: [],
  notes: null,
};
const paymentInfoRef = doc(db, "settings", "paymentInfo");

// Kept in sync by hand with js/constants.js's CATEGORIES -- not imported
// directly to avoid a circular import (constants.js already imports
// SiteSettings from this file).
const BUILTIN_CATEGORY_IDS = ["vegetables", "fruits", "wheat", "cotton", "barley", "rice", "organic", "animal-feed", "nurseries"];

function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `category-${Date.now()}`
  );
}

export const SiteSettings = {
  async getSiteImagesOnce() {
    const snap = await getDoc(siteImagesRef);
    return snap.exists() ? { ...DEFAULT_SITE_IMAGES, ...snap.data() } : DEFAULT_SITE_IMAGES;
  },

  subscribeSiteImages(callback) {
    return onSnapshot(
      siteImagesRef,
      (snap) => callback(snap.exists() ? { ...DEFAULT_SITE_IMAGES, ...snap.data() } : DEFAULT_SITE_IMAGES),
      () => callback(DEFAULT_SITE_IMAGES),
    );
  },

  async updateHeroImages(heroImages) {
    await setDoc(siteImagesRef, { heroImages }, { merge: true });
  },

  async updateCategoryImage(category, url) {
    await setDoc(siteImagesRef, { categoryImages: { [category]: url } }, { merge: true });
  },

  async updateLogoUrl(url) {
    await setDoc(siteImagesRef, { logoUrl: url }, { merge: true });
  },

  async getSiteContentOnce() {
    const snap = await getDoc(siteContentRef);
    return snap.exists() ? { ...DEFAULT_SITE_CONTENT, ...snap.data() } : DEFAULT_SITE_CONTENT;
  },

  async updateSiteContent(locale, patch) {
    await setDoc(siteContentRef, { [locale]: patch }, { merge: true });
  },

  subscribeSiteTheme(callback) {
    return onSnapshot(
      siteThemeRef,
      (snap) => callback(snap.exists() ? { ...DEFAULT_SITE_THEME, ...snap.data() } : DEFAULT_SITE_THEME),
      () => callback(DEFAULT_SITE_THEME),
    );
  },

  async updateSiteTheme(primaryColor) {
    await setDoc(siteThemeRef, { primaryColor }, { merge: true });
  },

  async updateCursorSize(cursorSize) {
    await setDoc(siteThemeRef, { cursorSize }, { merge: true });
  },

  // Regular users only -- an admin's own view always keeps the cursor
  // effect regardless of this setting (enforced client-side in layout.js by
  // gating on authState.isAdmin, not here).
  async updateCursorEffectDisabled(disabled) {
    await setDoc(siteThemeRef, { cursorEffectDisabled: disabled }, { merge: true });
  },

  // The default light/dark mode shown to a visitor who has never touched
  // the theme toggle themselves -- see state.js's applySiteDefaultDarkMode,
  // which never overrides a visitor's own explicit choice.
  async updateDefaultDarkMode(isDark) {
    await setDoc(siteThemeRef, { defaultDarkMode: isDark }, { merge: true });
  },

  subscribeSocialLinks(callback) {
    return onSnapshot(
      socialLinksRef,
      (snap) => callback(snap.exists() ? { ...DEFAULT_SOCIAL_LINKS, ...snap.data() } : DEFAULT_SOCIAL_LINKS),
      () => callback(DEFAULT_SOCIAL_LINKS),
    );
  },

  async updateSocialLinks(links) {
    await setDoc(socialLinksRef, { links }, { merge: true });
  },

  async updateContactInfo({ phone, whatsapp, email, policyLink }) {
    await setDoc(
      socialLinksRef,
      { phone: phone || null, whatsapp: whatsapp || null, email: email || null, policyLink: policyLink || null },
      { merge: true },
    );
  },

  async getAdPlacementsOnce() {
    const snap = await getDoc(adPlacementsRef);
    return snap.exists() ? { ...DEFAULT_AD_PLACEMENTS, ...snap.data() } : DEFAULT_AD_PLACEMENTS;
  },

  subscribeAdPlacements(callback) {
    return onSnapshot(
      adPlacementsRef,
      (snap) => callback(snap.exists() ? { ...DEFAULT_AD_PLACEMENTS, ...snap.data() } : DEFAULT_AD_PLACEMENTS),
      () => callback(DEFAULT_AD_PLACEMENTS),
    );
  },

  async updateAdPlacementEnabled(placement, enabled) {
    await setDoc(adPlacementsRef, { [placement]: enabled }, { merge: true });
  },

  async getCategoriesConfigOnce() {
    const snap = await getDoc(categoriesConfigRef);
    return snap.exists() ? { ...DEFAULT_CATEGORIES_CONFIG, ...snap.data() } : DEFAULT_CATEGORIES_CONFIG;
  },

  subscribeCategoriesConfig(callback) {
    return onSnapshot(
      categoriesConfigRef,
      (snap) => callback(snap.exists() ? { ...DEFAULT_CATEGORIES_CONFIG, ...snap.data() } : DEFAULT_CATEGORIES_CONFIG),
      () => callback(DEFAULT_CATEGORIES_CONFIG),
    );
  },

  async addCustomCategory({ ar, en, imageUrl }) {
    const config = await SiteSettings.getCategoriesConfigOnce();
    const id = slugify(en);
    if (BUILTIN_CATEGORY_IDS.includes(id)) {
      throw new Error(`category-id-collision-builtin:${id}`);
    }
    if (config.extra.some((c) => c.id === id)) {
      throw new Error(`category-id-collision-existing:${id}`);
    }
    const next = [...config.extra, { id, ar, en, imageUrl: imageUrl || null }];
    await setDoc(categoriesConfigRef, { extra: next }, { merge: true });
    return id;
  },

  async removeCustomCategory(id) {
    const config = await SiteSettings.getCategoriesConfigOnce();
    await setDoc(categoriesConfigRef, { extra: config.extra.filter((c) => c.id !== id) }, { merge: true });
  },

  async toggleCategoryHidden(id, hidden) {
    const config = await SiteSettings.getCategoriesConfigOnce();
    const nextHidden = hidden
      ? [...new Set([...config.hidden, id])]
      : config.hidden.filter((h) => h !== id);
    await setDoc(categoriesConfigRef, { hidden: nextHidden }, { merge: true });
  },

  async getPublicStatsOnce() {
    const snap = await getDoc(publicStatsRef);
    return snap.exists() ? { ...DEFAULT_PUBLIC_STATS, ...snap.data() } : DEFAULT_PUBLIC_STATS;
  },

  async incrementRegisteredFarmers() {
    await setDoc(publicStatsRef, { registeredFarmers: increment(1) }, { merge: true });
  },

  async incrementCompletedDeals() {
    await setDoc(publicStatsRef, { completedDeals: increment(1) }, { merge: true });
  },

  // Owner-only in firestore.rules regardless of who calls this client-side.
  subscribeKillSwitch(callback) {
    return onSnapshot(
      killSwitchRef,
      (snap) => callback(snap.exists() && snap.data().active === true),
      () => callback(false),
    );
  },

  async setKillSwitch(active) {
    await setDoc(killSwitchRef, { active }, { merge: true });
  },

  // Owner-only in firestore.rules regardless of who calls this client-side.
  subscribeMaintenanceMode(callback) {
    return onSnapshot(
      maintenanceModeRef,
      (snap) => callback(snap.exists() && snap.data().active === true),
      () => callback(false),
    );
  },

  async setMaintenanceMode(active) {
    await setDoc(maintenanceModeRef, { active }, { merge: true });
  },

  // Owner-only in firestore.rules regardless of who calls this client-side.
  subscribeChatDisabled(callback) {
    return onSnapshot(
      chatDisabledRef,
      (snap) => callback(snap.exists() && snap.data().active === true),
      () => callback(false),
    );
  },

  async setChatDisabled(active) {
    await setDoc(chatDisabledRef, { active }, { merge: true });
  },

  // Owner-only in firestore.rules regardless of who calls this client-side.
  subscribePaymentInfo(callback) {
    return onSnapshot(
      paymentInfoRef,
      (snap) => callback(snap.exists() ? { ...DEFAULT_PAYMENT_INFO, ...snap.data() } : DEFAULT_PAYMENT_INFO),
      () => callback(DEFAULT_PAYMENT_INFO),
    );
  },

  // One-time fetch for pages that just need to show it once alongside other
  // one-time data (cart.js, dashboard-my-orders.js) rather than keep a live
  // subscription open.
  async getPaymentInfoOnce() {
    const snap = await getDoc(paymentInfoRef);
    return snap.exists() ? { ...DEFAULT_PAYMENT_INFO, ...snap.data() } : DEFAULT_PAYMENT_INFO;
  },

  // Replaces the whole methods list -- the admin UI manages it client-side
  // (add/remove/edit/toggle) and saves the full resulting array at once,
  // same pattern as admin-branding.js's category list management.
  async setPaymentMethods(methods) {
    await setDoc(paymentInfoRef, { methods }, { merge: true });
  },

  async updatePaymentNotes(notes) {
    await setDoc(paymentInfoRef, { notes: notes || null }, { merge: true });
  },
};

// ===========================================================================
// Admin team chat — one shared room every admin can read/post in, never
// exposed to regular users (see the isAdmin()-gated firestore.rules match).
// ===========================================================================
const adminChatsCol = collection(db, "adminChats");

export const AdminChat = {
  async sendMessage({ senderId, senderName, text, fileUrl, fileName, fileType }) {
    await addDoc(adminChatsCol, {
      senderId,
      senderName,
      text: text || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      fileType: fileType || null,
      createdAt: serverTimestamp(),
    });
  },

  subscribeMessages(callback) {
    const q = query(adminChatsCol, orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  async updateMessage(id, text) {
    await updateDoc(doc(db, "adminChats", id), { text });
  },

  async deleteMessage(id) {
    await deleteDoc(doc(db, "adminChats", id));
  },

  // Best-effort client-side daily cleanup: no Cloud Functions/cron exist in
  // this project, so this just runs whenever any admin has the team chat
  // page open, deleting anything older than 24h. Failures (e.g. a message
  // just outside another admin's own edit window mid-delete) are swallowed
  // per-item so one failure doesn't block the rest.
  async purgeOldMessages() {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const snap = await getDocs(query(adminChatsCol, where("createdAt", "<", cutoff)));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  },
};

// ===========================================================================
// Notifications — any user's client may write into another user's inbox
// (e.g. a buyer's offer notifying the farmer); see firestore.rules for the
// narrow, informational-only field allowlist that makes this safe.
// ===========================================================================
const notificationsCol = collection(db, "notifications");

export const Notifications = {
  // Does NOT swallow its own errors -- callers that want fire-and-forget
  // behavior (most of them: a notification failing shouldn't block the
  // primary action like sending a chat message) add their own .catch(() =>
  // {}). Callers where the notification IS the primary action (admin
  // sending a message to a user) need the real error to surface instead of
  // silently claiming success.
  async create({ uid, key, params, link }) {
    await addDoc(notificationsCol, {
      uid,
      key,
      params: params ?? {},
      link: link ?? null,
      read: false,
      createdAt: serverTimestamp(),
    });
  },

  subscribeMine(uid, callback) {
    const q = query(notificationsCol, where("uid", "==", uid), orderBy("createdAt", "desc"), limit(30));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => callback([]));
  },

  async markRead(id) {
    await updateDoc(doc(db, "notifications", id), { read: true });
  },

  async markAllRead(notifs) {
    await Promise.all(notifs.filter((n) => !n.read).map((n) => updateDoc(doc(db, "notifications", n.id), { read: true })));
  },

  // Fans one notification doc out to every user's inbox. Batched in groups
  // of 500 (Firestore's per-batch write limit).
  async broadcastToAll(uids, { key, params, link }) {
    for (let i = 0; i < uids.length; i += 500) {
      const batch = writeBatch(db);
      for (const uid of uids.slice(i, i + 500)) {
        batch.set(doc(notificationsCol), {
          uid,
          key,
          params: params ?? {},
          link: link ?? null,
          read: false,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  },
};
