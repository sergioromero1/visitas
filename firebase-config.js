// Configuración web de Firebase (Consola → Configuración del proyecto → Tus apps → SDK config).
// Estos valores son públicos por diseño: la seguridad la dan las reglas de Firestore (firestore.rules).
// Mientras apiKey diga REEMPLAZAR, la app funciona en "modo local": todo queda solo en el dispositivo.
export const firebaseConfig = {
  apiKey: 'REEMPLAZAR',
  authDomain: 'REEMPLAZAR.firebaseapp.com',
  projectId: 'REEMPLAZAR',
  storageBucket: 'REEMPLAZAR.firebasestorage.app',
  messagingSenderId: 'REEMPLAZAR',
  appId: 'REEMPLAZAR'
};
