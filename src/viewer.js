import * as THREE from 'three';
import { TrainOrbitControls } from './train-controls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { blenderCamera, restoreAppearance, createPipeline, configureStudioShadows } from './appearance.js';

const ASSETS = new URL('../assets/', import.meta.url);
const normalizeName = name => name.toLowerCase().replace(/[\s_.-]/g, '');

export class TrainViewer {
  constructor(container, { onStatus = () => {}, onProgress = () => {}, heroCameraNames = ['Camera01_hero', 'Hero shot', 'Hero', 'Camera_Hero'] } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.heroCameraNames = heroCameraNames.map(normalizeName);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    // Blender's standard glTF exporter already converts Z-up to glTF Y-up.
    // Preserve exported metre scale and node transforms; do not rotate a second time.
    this.trainRoot = new THREE.Group();
    this.trainRoot.name = 'TrainRoot';
    this.environmentRoot = new THREE.Group();
    this.environmentRoot.name = 'EnvironmentRoot';
    this.scene.add(this.environmentRoot, this.trainRoot);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 10000);
    this.camera.position.set(-30, 12, 25);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D 列车场景，左键或单指旋转，中键或双指平移，滚轮或双指捏合缩放');
    this.controls = new TrainOrbitControls(this.camera, this.renderer.domElement);
    this.controls.orbitRoot = this.trainRoot;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 2000;
    // A gesture takes ownership immediately, including during a camera transition.
    this.controls.addEventListener('start', () => { this.transition = null; });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.onContextLost = event => { event.preventDefault(); this.onStatus('显卡上下文已丢失，请刷新页面重新加载。', true); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.setAnimationLoop(time => this.render(time));
  }

  async load() {
    const response = await fetch(new URL('scene-settings.json', ASSETS));
    if (!response.ok) throw new Error('Blender 场景参数加载失败');
    this.settings = await response.json();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const fetchGLB = async name => {
      this.onStatus(`正在加载 ${name}…`);
      try {
        return await loader.loadAsync(new URL(name, ASSETS).href, progress => {
          const amount = progress.total ? `${Math.round(progress.loaded / progress.total * 100)}%` : `${(progress.loaded / 1e6).toFixed(1)} MB`;
          this.onStatus(`正在加载 ${name} · ${amount}`);
          const start = name === 'environment.glb' ? 0 : 20;
          if (progress.total) this.onProgress(start + progress.loaded / progress.total * (name === 'environment.glb' ? 20 : 40));
        });
      } catch (error) { throw new Error(`${name} 加载失败`, { cause: error }); }
    };
    // Sequential loading limits peak memory for large railway assets.
    const environment = await fetchGLB('environment.glb');
    this.environmentRoot.add(environment.scene);
    const train = await fetchGLB('default_train.glb');
    this.trainRoot.add(train.scene);
    this.defaultTrain = train.scene;
    this.onStatus('正在生成 HDR 环境光和反射…');
    try {
      this.hdr = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(new URL('environment.hdr', ASSETS).href, event => { if (event.total) this.onProgress(60 + event.loaded / event.total * 20); });
      const pixels = this.hdr.image.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const gray = Math.max(pixels[i], pixels[i+1], pixels[i+2]);
        const value = Math.max(0, gray * 1.01 - 0.005);
        pixels[i] = pixels[i+1] = pixels[i+2] = value;
      }
      this.hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environmentMap = pmrem.fromEquirectangular(this.hdr);
      pmrem.dispose();
      this.scene.environment = this.environmentMap.texture;
    } catch (error) { throw new Error('environment.hdr 加载失败', { cause: error }); }
    this.onProgress(85);
    restoreAppearance(this.scene, this.settings);
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.add(blenderCamera(this.settings.camera));
    this.scene.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.trainRoot);
    if (this.bounds.isEmpty()) throw new Error('列车文件不包含可显示的几何体');
    const sphere = this.bounds.getBoundingSphere(new THREE.Sphere());
    this.camera.far = Math.max(10000, sphere.radius * 30);
    this.controls.maxDistance = Math.max(2000, sphere.radius * 15);
    const cameras = [];
    this.scene.traverse(object => { if (object.isCamera) cameras.push(object); });
    const source = cameras.find(camera => this.heroCameraNames.includes(normalizeName(camera.name)));
    this.heroCamera = source || null;
    this.heroSource = source ? `预设来自 GLB：${source.name}` : 'GLB 未包含 Hero 相机 · 使用自动构图';
    this.goToHero(false);
    this.pipeline = await createPipeline(this.renderer, this.scene, this.camera, ASSETS);
    this.resize();
    this.onProgress(95);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.pipeline.composer.render();
    this.ready = true;
    this.onProgress(100);
    this.onStatus('场景已就绪');
  }

  heroView() {
    const center = this.bounds.getCenter(new THREE.Vector3());
    if (this.heroCamera) {
      const position = this.heroCamera.getWorldPosition(new THREE.Vector3());
      const rotation = this.heroCamera.getWorldQuaternion(new THREE.Quaternion());
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
      // glTF cameras do not contain a look-at target. Project train center onto
      // the viewing ray to preserve the camera's exported direction exactly.
      const distance = this.heroCamera.userData.orbitDistance || Math.max(center.clone().sub(position).dot(direction), 1);
      return { position, target: position.clone().addScaledVector(direction, distance), up: new THREE.Vector3(0, 1, 0).applyQuaternion(rotation), fov: this.presetFov() };
    }
    // The supplied train is 205 m long. Frame its leading carriage as the Hero
    // rather than shrinking the entire consist into a thin line on screen.
    const span = Math.min(30, this.bounds.getSize(new THREE.Vector3()).x);
    const target = new THREE.Vector3(this.bounds.min.x + span * 0.65, center.y, center.z);
    const position = new THREE.Vector3(this.bounds.min.x - span * 0.9, center.y + span * 0.3, center.z + span * 0.85);
    if (this.camera.aspect < 1) position.sub(target).multiplyScalar(1 / this.camera.aspect).add(target);
    return { position, target, up: new THREE.Vector3(0, 1, 0), fov: 40 };
  }

  goToHero(animate = true) {
    if (!this.bounds) return;
    const view = this.heroView();
    // Drain pending damping before taking a snapshot so it cannot shift the preset.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.transition = null;
      this.applyView(view);
      return;
    }
    this.transition = { start: performance.now(), duration: 1100, from: { position: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone(), fov: this.camera.fov }, to: view };
  }

  resetView() { this.goToHero(); }

  async uploadTrain(file) {
    if (this.replacing || this.disposed) return;
    this.replacing = true;
    let candidate;
    try {
      if (!/\.glb$/i.test(file.name)) throw new Error('请选择 GLB 文件');
      const bytes = await file.arrayBuffer();
      validateGLB(bytes);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(bytes, '');
      candidate = gltf.scene;
      if (this.disposed) throw new Error('预览已关闭');
      const bounds = new THREE.Box3().setFromObject(candidate);
      if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error('GLB 中没有有效的模型');
      // Uploaded files supply train geometry/materials, never scene lighting.
      const lights = []; candidate.traverse(object => { if (object.isLight) lights.push(object); });
      lights.forEach(light => light.removeFromParent());
      configureStudioShadows(candidate);
      await this.renderer.compileAsync(candidate, this.camera, this.scene);
      if (this.disposed) throw new Error('预览已关闭');
      this.replaceTrain(candidate);
      candidate = null;
    } finally {
      if (candidate) disposeModel(candidate);
      this.replacing = false;
    }
  }

  replaceTrain(model) {
    const previous = this.trainRoot.children[0];
    if (previous === model) return;
    this.trainRoot.clear();
    this.trainRoot.add(model);
    if (previous && previous !== this.defaultTrain) disposeModel(previous);
    this.renderer.shadowMap.needsUpdate = true;
  }

  resetTrain() {
    if (!this.replacing && !this.disposed) this.replaceTrain(this.defaultTrain);
  }

  presetFov() {
    const fov = this.heroCamera?.isPerspectiveCamera ? this.heroCamera.fov : 40;
    const referenceAspect = this.heroCamera?.userData.referenceAspect || this.camera.aspect;
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.max(1, referenceAspect / this.camera.aspect)));
  }

  applyView(view) {
    this.camera.position.copy(view.position);
    this.camera.up.copy(view.up).normalize();
    this.camera.fov = view.fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(view.target);
    // Presets intentionally restore the exact Blender transform, not an orbit.
    const orbitRoot = this.controls.orbitRoot;
    this.controls.orbitRoot = null;
    this.controls.update();
    this.controls.orbitRoot = orbitRoot;
  }

  setBlackBackground(black) { this.scene.background = black || !this.hdr ? new THREE.Color(0x000000) : this.hdr; }

  resize() {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    if (this.heroCamera) this.camera.fov = this.presetFov();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.pipeline?.composer.setSize(width, height);
  }

  render(time) {
    if (this.transition) {
      const { start, duration, from, to } = this.transition;
      const t = THREE.MathUtils.clamp((time - start) / duration, 0, 1), eased = t * t * (3 - 2 * t);
      this.applyView({ position: from.position.clone().lerp(to.position, eased), target: from.target.clone().lerp(to.target, eased), up: from.up.clone().lerp(to.up, eased), fov: THREE.MathUtils.lerp(from.fov, to.fov, eased) });
      if (t === 1) this.transition = null;
    } else this.controls.update();
    if (this.pipeline) this.pipeline.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.defaultTrain && !this.defaultTrain.parent) disposeModel(this.defaultTrain);
    const resources = new Set();
    this.scene.traverse(object => {
      if (object.isLight) object.shadow?.dispose();
      if (object.geometry) resources.add(object.geometry);
      for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    });
    for (const resource of resources) { if (resource.isTexture) resource.source?.data?.close?.(); resource.dispose(); }
    this.environmentMap?.dispose();
    this.hdr?.dispose();
    this.pipeline?.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function validateGLB(bytes) {
  const view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error('文件不是完整的 GLB 2.0 模型');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) throw new Error('GLB 数据损坏');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  if ([...(json.buffers || []), ...(json.images || [])].some(item => item.uri && !item.uri.startsWith('data:'))) throw new Error('请导出将贴图嵌入文件的 GLB');
}

export function disposeModel(root) {
  const resources = new Set();
  root.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) { if (resource.isTexture) resource.source?.data?.close?.(); resource.dispose(); }
}
