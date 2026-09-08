import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MeshoptSimplifier } from 'meshoptimizer';

// Offline preparation only. Originals are opened read-only; all transforms stay intact.
const source = process.argv[2] || 'F:/3D/Samples/3D Preview Sample/CAPTAIN_3D Preview Sample_3_20260908.glb';
const fd = fs.openSync(source, 'r');
function read(offset, length) { const b = Buffer.alloc(length); fs.readSync(fd, b, 0, length, offset); return b; }
const header = read(0, 20);
if (header.readUInt32LE(0) !== 0x46546c67) throw Error('Invalid GLB');
const jsonLength = header.readUInt32LE(12);
const src = JSON.parse(read(20, jsonLength));
if (fs.existsSync('tools/recovered-materials.json')) {
  const restored = JSON.parse(fs.readFileSync('tools/recovered-materials.json'));
  src.materials = src.materials.map(m => restored[m.name] ? { ...m, ...restored[m.name] } : m);
  src.extensionsUsed = [...new Set([...src.extensionsUsed, 'KHR_materials_ior', 'KHR_materials_transmission'])];
}
const protectedMeshes = new Set(src.nodes.filter(n => /Mainbody|Sidewindow|CRRC_Corporation|windshield/i.test(n.name)).map(n => n.mesh));
if (fs.existsSync('assets/blender-source.json')) {
  const blender = JSON.parse(fs.readFileSync('assets/blender-source.json'));
  for (const m of src.materials) {
    const group = blender.materials.find(b => b.name === m.name)?.tree?.nodes.find(n => n.name === '.simple_uv_mapping');
    if (!group) continue;
    const scale = group.inputs.find(s => s.name === 'Scale').value;
    function mapTextures(object) {
      for (const [key, value] of Object.entries(object)) {
        if (!value || typeof value !== 'object') continue;
        if (key.endsWith('Texture') && value.index !== undefined) value.extensions = { ...value.extensions, KHR_texture_transform: { scale: [scale, scale] } };
        else mapTextures(value);
      }
    }
    mapTextures(m);
  }
  src.extensionsUsed = [...new Set([...src.extensionsUsed, 'KHR_texture_transform'])];
}
const binStart = 28 + jsonLength;
await MeshoptSimplifier.ready;
const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const types = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
function accessor(index) {
  const a = src.accessors[index], v = src.bufferViews[a.bufferView], T = types[a.componentType];
  const stride = sizes[a.type] * T.BYTES_PER_ELEMENT;
  if (a.sparse || (v.byteStride && v.byteStride !== stride)) throw Error('Unsupported accessor layout');
  const b = read(binStart + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * stride);
  return new T(b.buffer, b.byteOffset, a.count * sizes[a.type]);
}
const trainRoots = src.scenes[src.scene || 0].nodes.filter(i => src.nodes[i].name === 'Yuhang Ke_HST_20260723');
if (trainRoots.length !== 1) throw Error('Expected exactly one train root; inspect source before splitting');
const report = { source, sourceBytes: fs.statSync(source).size, sourceCameras: src.cameras || [], outputs: [] };
fs.mkdirSync('assets', { recursive: true });
for (const [name, roots] of [['environment', src.scenes[0].nodes.filter(i => !trainRoots.includes(i))], ['default_train', trainRoots]]) {
  const dst = { asset: src.asset, scene: 0, scenes: [{ name, nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [], materials: src.materials, textures: src.textures, images: structuredClone(src.images), samplers: src.samplers, extensionsUsed: src.extensionsUsed, extensionsRequired: src.extensionsRequired };
  const chunks = []; let byteLength = 0, inputTriangles = 0, outputTriangles = 0;
  function bufferView(data) {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const i = dst.bufferViews.length;
    dst.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    chunks.push(bytes); byteLength += bytes.length;
    const pad = (4 - byteLength % 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    return i;
  }
  function addAccessor(data, original, count) {
    const a = { ...original, bufferView: bufferView(data), byteOffset: 0, count };
    delete a.min; delete a.max;
    if (a.type === 'VEC3' && a.componentType === 5126) {
      a.min = [Infinity, Infinity, Infinity]; a.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) { const k = i % 3; a.min[k] = Math.min(a.min[k], data[i]); a.max[k] = Math.max(a.max[k], data[i]); }
    }
    return dst.accessors.push(a) - 1;
  }
  for (const img of dst.images) {
    const v = src.bufferViews[img.bufferView];
    img.bufferView = bufferView(read(binStart + (v.byteOffset || 0), v.byteLength));
  }
  const meshMap = new Map(), primitiveCache = new Map();
  function mesh(index) {
    if (meshMap.has(index)) return meshMap.get(index);
    const m = src.meshes[index], result = { name: m.name, primitives: [] };
    for (const p of m.primitives) {
      const pos = accessor(p.attributes.POSITION), indices = Uint32Array.from(accessor(p.indices));
      inputTriangles += indices.length / 3;
      const hash = createHash('sha256');
      const attributes = Object.fromEntries(Object.entries(p.attributes).map(([key, i]) => [key, accessor(i)]));
      hash.update(Buffer.from(indices.buffer));
      for (const [key, values] of Object.entries(attributes)) { hash.update(key); hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength)); }
      const key = hash.digest('hex');
      if (primitiveCache.has(key)) {
        const cached = primitiveCache.get(key); result.primitives.push({ ...cached, material: p.material });
        outputTriangles += dst.accessors[cached.indices].count / 3;
        continue;
      }
      const target = Math.max(300, Math.floor(indices.length * 0.025 / 3) * 3);
      const [reduced] = indices.length > 12000 && !protectedMeshes.has(index) ? MeshoptSimplifier.simplify(indices, pos, 3, target, 0.001) : [indices];
      const [remap, count] = MeshoptSimplifier.compactMesh(reduced);
      const out = { attributes: {}, indices: addAccessor(reduced, { componentType: 5125, type: 'SCALAR' }, reduced.length), material: p.material };
      for (const [key, values] of Object.entries(attributes)) {
        const a = src.accessors[p.attributes[key]], width = sizes[a.type], compact = new values.constructor(count * width);
        for (let old = 0; old < remap.length; old++) if (remap[old] !== 0xffffffff) compact.set(values.subarray(old * width, (old + 1) * width), remap[old] * width);
        out.attributes[key] = addAccessor(compact, a, count);
      }
      primitiveCache.set(key, out); result.primitives.push(out); outputTriangles += reduced.length / 3;
    }
    const id = dst.meshes.push(result) - 1; meshMap.set(index, id);
    console.log(`${name}: mesh ${index} -> ${id}, ${(byteLength / 1e6).toFixed(1)} MB`);
    return id;
  }
  function node(index) {
    const n = structuredClone(src.nodes[index]), id = dst.nodes.push(n) - 1;
    if (n.mesh !== undefined) n.mesh = mesh(n.mesh);
    if (n.children) n.children = n.children.map(node);
    return id;
  }
  dst.scenes[0].nodes = roots.map(node);
  dst.buffers = [{ byteLength }];
  const json = Buffer.from(JSON.stringify(dst)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + padded.length + byteLength, 8); h.writeUInt32LE(padded.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(byteLength, 0); bh.writeUInt32LE(0x004e4942, 4);
  const filename = `assets/${name}.glb`, out = fs.openSync(filename, 'w');
  for (const chunk of [h, padded, bh, ...chunks]) fs.writeSync(out, chunk);
  fs.closeSync(out);
  report.outputs.push({ filename, bytes: fs.statSync(filename).size, inputTriangles, outputTriangles, nodes: dst.nodes.length });
}
fs.closeSync(fd);
// HDR is prepared separately from the actual Blender world, not a guessed folder image.
fs.writeFileSync('assets/asset-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
