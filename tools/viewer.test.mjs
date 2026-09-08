import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrainViewer } from '../src/viewer.js';
import { blenderCamera } from '../src/appearance.js';
import fs from 'node:fs';

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
