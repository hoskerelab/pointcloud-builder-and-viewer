const MAGIC = '\x93NUMPY';

export interface NpyResult<T extends Float32Array | Float64Array> {
  dtype: string;
  fortranOrder: boolean;
  shape: number[];
  data: T;
}

function readHeader(buffer: ArrayBuffer): {
  header: string;
  offset: number;
  version: { major: number; minor: number };
} {
  const magicBytes = new Uint8Array(buffer, 0, 6);
  const view = new DataView(buffer);
  const magic = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, 6));

  // --- Start Debug Logs ---
  console.log('[npy.ts readHeader] Checking signature...');
  console.log(`[npy.ts readHeader] Read magic bytes (hex): ${Array.from(magicBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  // --- End Debug Logs ---

  // --- FIX: Compare bytes directly ---
  const expectedMagicBytes = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // Hex for \x93NUMPY
  let signatureMatch = true;
  if (magicBytes.length !== expectedMagicBytes.length) {
      signatureMatch = false;
  } else {
      for (let i = 0; i < magicBytes.length; i++) {
          if (magicBytes[i] !== expectedMagicBytes[i]) {
              signatureMatch = false;
              break;
          }
      }
  }
  // --- End FIX ---

  // Use the boolean result for the check
  if (!signatureMatch) {
    console.error('[npy.ts readHeader] Signature mismatch!');
    // Optionally log the decoded string for context, but don't use it for comparison
    const decodedMagicForLog = new TextDecoder('latin1').decode(magicBytes);
    console.log(`[npy.ts readHeader] Decoded magic string was: "${decodedMagicForLog}"`);
    console.log(`[npy.ts readHeader] Expected bytes (hex): ${expectedMagicBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    throw new Error('Invalid NPY file signature (Byte mismatch)');
  } else {
    // Log success if needed
    console.log('[npy.ts readHeader] Signature matches (Byte comparison).');
  }

  const major = view.getUint8(6);
  const minor = view.getUint8(7);

  let headerLen = 0;
  let offset = 0;

  if (major === 1) {
    headerLen = view.getUint16(8, true);
    offset = 10;
  } else if (major === 2) {
    headerLen = view.getUint32(8, true);
    offset = 12;
  } else {
    throw new Error(`Unsupported NPY version: ${major}.${minor}`);
  }

  const headerBytes = new Uint8Array(buffer, offset, headerLen);
  const header = new TextDecoder('latin1').decode(headerBytes).trim();

  return {
    header,
    offset: offset + headerLen,
    version: { major, minor },
  };
}

function parseHeader(header: string): { descr: string; fortranOrder: boolean; shape: number[] } {
  const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/);
  const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/);
  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/);

  if (!descrMatch || !fortranMatch || !shapeMatch) {
    throw new Error(`Unable to parse NPY header: ${header}`);
  }

  const descr = descrMatch[1];
  const fortranOrder = fortranMatch[1] === 'True';
  const shapeValues = shapeMatch[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(value => Number.parseInt(value, 10));

  if (shapeValues.length === 1 && header.includes('(1,)')) {
    shapeValues.push(1);
  }

  return {
    descr,
    fortranOrder,
    shape: shapeValues,
  };
}

export function parseNpy(buffer: ArrayBuffer): NpyResult<Float32Array | Float64Array> {
  // --- Start Debug Logs ---
  console.log('[npy.ts parseNpy] Received buffer:', buffer);
  if (buffer) {
     console.log(`[npy.ts parseNpy] buffer type: ${buffer.constructor.name}`);
     console.log(`[npy.ts parseNpy] buffer byteLength: ${buffer.byteLength}`);
     const firstBytes = new Uint8Array(buffer.slice(0, 10));
     console.log(`[npy.ts parseNpy] buffer first 10 bytes (hex): ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  } else {
     console.error('[npy.ts parseNpy] Received null or undefined buffer!');
     throw new Error('Received invalid buffer in parseNpy');
  }
  // --- End Debug Logs ---

  const { header, offset } = readHeader(buffer);
  const { descr, fortranOrder, shape } = parseHeader(header);

  if (fortranOrder) {
    throw new Error('Fortran-ordered NPY arrays are not supported');
  }

  let data: Float32Array | Float64Array;

  if (descr === '<f4' || descr === '|f4' || descr === '<f') {
    data = new Float32Array(buffer, offset);
  } else if (descr === '<f8' || descr === '|f8') {
    data = new Float64Array(buffer, offset);
  } else {
    throw new Error(`Unsupported dtype "${descr}" in NPY file`);
  }

  return {
    dtype: descr,
    fortranOrder,
    shape,
    data,
  };
}
