import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrainViewer, validateGLB } from '../src/viewer.js';
import { blenderCamera } from '../src/appearance.js';
import fs from 'node:fs';
import { TrainOrbitControls } from '../src/train-controls.js';

test('orbit stays centred on train origin after pan and throughout damping', () => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(10, 7, 20);
  const controls = new TrainOrbitControls(camera);
  controls.target.set(5, 2, 3); controls.update();
  const root = new THREE.Group(); root.position.set(1, 0, -2);
  controls.orbitRoot = root;
  const distance = camera.position.distanceTo(root.position);
  const targetDistance = controls.target.distanceTo(root.position);
  controls.enableDamping = true;
  controls._rotateLeft(0.5); controls._rotateUp(0.2);
  for (let i = 0; i < 200; i++) controls.update();
  assert.ok(Math.abs(camera.position.distanceTo(root.position) - distance) < 1e-5);
  assert.ok(Math.abs(controls.target.distanceTo(root.position) - targetDistance) < 1e-5);
});

test('replacement preserves environment and default resources, and disposes previous upload', () => {
  const viewer = fixture();
  viewer.trainRoot = new THREE.Group();
  viewer.defaultTrain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  viewer.trainRoot.add(viewer.defaultTrain);
  viewer.renderer = { shadowMap: {} };
  let disposed = false;
  const uploaded = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  uploaded.geometry.addEventListener('dispose', () => { disposed = true; });
  viewer.replaceTrain(uploaded);
  assert.equal(viewer.trainRoot.children[0], uploaded);
  assert.equal(viewer.defaultTrain.parent, null);
  viewer.resetTrain();
  assert.equal(viewer.trainRoot.children[0], viewer.defaultTrain);
  assert.equal(disposed, true);
});

test('invalid upload leaves original train attached and releases loading lock', async () => {
  const viewer = fixture(); viewer.trainRoot = new THREE.Group();
  const original = new THREE.Group(); viewer.trainRoot.add(original);
  await assert.rejects(viewer.uploadTrain({ name: 'bad.glb', arrayBuffer: async () => new ArrayBuffer(4) }), /GLB/);
  assert.equal(viewer.trainRoot.children[0], original);
  assert.equal(viewer.replacing, false);
});

test('GLB validation rejects external textures', () => {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'outside.png' }] }));
  const bytes = new ArrayBuffer(20 + json.length), view = new DataView(bytes);
  [0x46546c67, 2, bytes.byteLength, json.length, 0x4e4f534a].forEach((n, i) => view.setUint32(i * 4, n, true));
  new Uint8Array(bytes, 20).set(json);
  assert.throws(() => validateGLB(bytes), /贴图/);
});

function fixture() {
  const viewer = Object.create(TrainViewer.prototype);
  viewer.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 10000);
  viewer.controls = { target: new THREE.Vector3(), update() { viewer.camera.lookAt(this.target); } };
  viewer.bounds = new THREE.Box3(new THREE.Vector3(0, 0, -2), new THREE.Vector3(205, 4, 2));
  return viewer;
}
test('nested Blender camera transform moves the persistent main camera', () => {
  const viewer = fixture(), main = viewer.camera;
  const parent = new THREE.Group(); parent.position.set(5, 2, -3); parent.rotation.y = 0.4;
  const source = new THREE.PerspectiveCamera(52); source.position.set(-25, 12, 20); source.lookAt(20, 2, 0); parent.add(source); parent.updateMatrixWorld(true);
  viewer.heroCamera = source;
  const expected = source.getWorldQuaternion(new THREE.Quaternion());
  viewer.applyView(viewer.heroView());
  assert.equal(viewer.camera, main);
  assert.ok(viewer.camera.position.distanceTo(source.getWorldPosition(new THREE.Vector3())) < 1e-9);
  assert.ok(viewer.camera.quaternion.angleTo(expected) < 1e-6);
  assert.equal(viewer.camera.fov, 52);
});
test('transition lands exactly and OrbitControls remains usable', () => {
  const viewer = fixture(), to = viewer.heroView();
  viewer.transition = { start: 0, duration: 1100, from: { position: new THREE.Vector3(0, 10, 20), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 60 }, to };
  viewer.renderer = { render() {} };
  viewer.render(550);
  assert.notEqual(viewer.camera.fov, to.fov);
  viewer.render(1100);
  assert.equal(viewer.transition, null);
  assert.ok(viewer.camera.position.distanceTo(to.position) < 1e-9);
  viewer.controls.target.x += 5; viewer.render(1200);
  assert.equal(viewer.controls.target.x, to.target.x + 5);
});
test('saved Blender camera maps Z-up metres to glTF Y-up and preserves framing', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../assets/scene-settings.json', import.meta.url))).camera;
  const source = blenderCamera(data);
  assert.ok(Math.abs(source.position.x - data.matrix[0][3]) < 1e-8);
  assert.ok(Math.abs(source.position.y - data.matrix[2][3]) < 1e-8);
  assert.ok(Math.abs(source.position.z + data.matrix[1][3]) < 1e-8);
  const viewer = fixture(); viewer.heroCamera = source;
  const wide = viewer.presetFov(); viewer.camera.aspect = 0.5;
  assert.ok(viewer.presetFov() > wide);
});
