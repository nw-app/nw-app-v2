const __cfg = {
  apiKey: "AIzaSyCRvuSL6t3RS5_523CGd3gxJgdRDuDXFvQ",
  authDomain: "nw-app-v2.firebaseapp.com",
  projectId: "nw-app-v2",
  storageBucket: "nw-app-v2.firebasestorage.app",
  messagingSenderId: "448152056602",
  appId: "1:448152056602:web:3ed9e5d9ed04d541cf32a3",
  measurementId: "G-G2ZD312B6V",
};

try { window.FIREBASE_CONFIG = __cfg; } catch {}
try { self.FIREBASE_CONFIG = __cfg; } catch {}

try { window.FIREBASE_VAPID_KEY = "BGfx7H-d1ok63jIOPnV4hKsTJz6zICLh6BqQMSBzjiwQYWj0Go4QkziSQrKCBr2S-bK8iuo5NUzQtKFzAhVkDGg"; } catch {}
try { self.FIREBASE_VAPID_KEY = "BGfx7H-d1ok63jIOPnV4hKsTJz6zICLh6BqQMSBzjiwQYWj0Go4QkziSQrKCBr2S-bK8iuo5NUzQtKFzAhVkDGg"; } catch {}

try { firebase.firestore?.setLogLevel?.("silent"); } catch {}
