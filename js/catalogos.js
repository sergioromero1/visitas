// ─────────────────────────────────────────────
//  Listas de la ficha rápida. Para agregar opciones basta con editar estos arreglos.
// ─────────────────────────────────────────────

export const TIPOS_ESTUDIO = [
  'Peritaje estructural', 'Evaluación estructural', 'Estudio de patología',
  'Vulnerabilidad sísmica', 'Reforzamiento estructural', 'Interventoría', 'Otro'
];

export const TIPOS_VISITA = [
  'Preliminar', 'Inspección detallada', 'Seguimiento', 'Toma de muestras / ensayos', 'Otra'
];

export const ELEMENTOS = [
  'Columna', 'Viga', 'Losa', 'Muro estructural', 'Muro de mampostería', 'Nudo',
  'Cimentación', 'Escalera', 'Cubierta', 'Fachada', 'Piso / contrapiso', 'Otro'
];

export const PATOLOGIAS = [
  'Fisura', 'Grieta', 'Humedad / filtración', 'Eflorescencia', 'Corrosión', 'Acero expuesto',
  'Desprendimiento', 'Hormigueros', 'Deflexión', 'Desplome', 'Asentamiento',
  'Daño por impacto', 'Intervención no técnica', 'Otro'
];

export const SEVERIDADES = [
  { id: 'leve', nombre: 'Leve', color: '#2e9e5b' },
  { id: 'moderada', nombre: 'Moderada', color: '#c99700' },
  { id: 'severa', nombre: 'Severa', color: '#e06a1b' },
  { id: 'critica', nombre: 'Crítica', color: '#d0312d' }
];

// ── Ficha estructural de la edificación ──
export const USOS = ['Vivienda', 'Comercio', 'Oficinas', 'Institucional', 'Industrial', 'Mixto', 'Otro'];

export const SISTEMAS = [
  'Pórticos de concreto', 'Muros de concreto', 'Sistema combinado / dual', 'Mampostería confinada',
  'Mampostería reforzada', 'Mampostería no reforzada', 'Bahareque / tapia / adobe', 'Estructura metálica',
  'Prefabricado', 'Otro'
];

export const ENTREPISOS = ['Losa maciza', 'Losa aligerada', 'Steel deck', 'Madera', 'Prefabricado', 'Otro'];

// Calificaciones con color (verde, amarillo, rojo), como la severidad
export const CALIDADES = [
  { id: 'Buena', color: '#2e9e5b' }, { id: 'Regular', color: '#c99700' }, { id: 'Mala', color: '#d0312d' }
];
export const ESTADOS = [
  { id: 'Bueno', color: '#2e9e5b' }, { id: 'Regular', color: '#c99700' }, { id: 'Malo', color: '#d0312d' }
];

export const MUROS_RETIRADOS = ['Sí', 'No', 'Sin determinar'];

const SIN_SEVERIDAD = '#4a5866';

export const colorSeveridad = id => SEVERIDADES.find(s => s.id === id)?.color || SIN_SEVERIDAD;
export const nombreSeveridad = id => SEVERIDADES.find(s => s.id === id)?.nombre || '';
