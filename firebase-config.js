// Configuración web de Firebase (Consola → Configuración del proyecto → Tus apps → SDK config).
// Estos valores son públicos por diseño: la seguridad la dan las reglas de Firestore (firestore.rules).
// Mientras apiKey diga REEMPLAZAR, la app funciona en "modo local": todo queda solo en el dispositivo.
export const firebaseConfig = {
  apiKey: 'AIzaSyCtnTilj88LSXlX1DxLnAR8iruqVL1pWw0',
  authDomain: 'dak-visitas.firebaseapp.com',
  projectId: 'dak-visitas',
  storageBucket: 'dak-visitas.firebasestorage.app',
  messagingSenderId: '584057765493',
  appId: '1:584057765493:web:c95edfea54240ce4ee423c'
};
