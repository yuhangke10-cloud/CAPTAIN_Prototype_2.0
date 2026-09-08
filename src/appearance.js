import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
export const blenderToWeb = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
export function blenderCamera(data) {
  const matrix = new THREE.Matrix4().set(...data.matrix.flat()).premultiply(blenderToWeb);
  const verticalFov = THREE.MathUtils.radToDeg(2 * Math.atan(data.sensor_width / (1920 / 1080) / (2 * data.lens)));
  const camera = new THREE.PerspectiveCamera(verticalFov, 1920 / 1080, 0.05, 10000);
  matrix.decompose(camera.position, camera.quaternion, camera.scale);
  camera.name = data.name;
  camera.userData.referenceAspect = 1920 / 1080;
  camera.userData.orbitDistance = data.orbitDistance;
  camera.updateMatrixWorld(true);
  return camera;
}
export function restoreAppearance(scene, settings) {
  scene.environmentIntensity = settings.worldStrength;
  scene.environmentRotation.y = -settings.worldRotation;
  RectAreaLightUniformsLib.init();
  const restored = new Set();
  scene.traverse(object => {
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
      if (restored.has(material)) continue;
      restored.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) value.anisotropy = 8;
      if (material.name === 'GLASS - windshield') {
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
            float glassCos=clamp(abs(dot(normal,normalize(vViewPosition))),0.0001,1.0);
            float glassFacing=1.0-pow(glassCos,0.72);
            float glassF0=pow((1.45-1.0)/(1.45+1.0),2.0);
            float glassF=glassF0+(1.0-glassF0)*pow(1.0-glassCos,5.0);
            float glassMix=mix(glassF,0.0330585837,glassFacing)/max(glassF,0.0001);
            material.specularColor*=glassMix; material.specularF90*=glassMix;`);
          shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', '#include <transmission_fragment>\n totalDiffuse *= (1.0-glassFacing);');
        };
        material.customProgramCacheKey = () => 'blender-glass-glossy-mix-v1';
        material.needsUpdate = true;
      }
      if (/Concrete|RubberVulcanized|HandleRubber/.test(material.name) && material.metalnessMap) {
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
            metalnessFactor = metalnessFactor <= 0.04045 ? metalnessFactor / 12.92 : pow((metalnessFactor + 0.055) / 1.055, 2.4);`);
        };
        material.customProgramCacheKey = () => 'blender-srgb-reflectance-v1';
        material.needsUpdate = true;
      }
      if (!material.userData.secondaryLayer) continue;
      const secondary = new THREE.Color().fromArray(material.userData.secondaryLayer);
      material.onBeforeCompile = shader => {
        shader.uniforms.secondaryPaint = { value: secondary };
        shader.fragmentShader = 'uniform vec3 secondaryPaint;\n' + shader.fragmentShader;
        // Original group: square(mix(Fresnel(4.75), Facing(0.75), 0.5)).
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          float paintCos=clamp(abs(dot(normal,normalize(vViewPosition))),0.0,1.0);
          float eta=4.75; float g=sqrt(eta*eta+paintCos*paintCos-1.0);
          float a=(g-paintCos)/(g+paintCos);
          float b=(paintCos*(g+paintCos)-1.0)/(paintCos*(g-paintCos)+1.0);
          float fresnel=0.5*a*a*(1.0+b*b);
          float facing=1.0-paintCos*paintCos;
          float paintMix=pow(0.5*(fresnel+facing),2.0);
          diffuseColor.rgb=mix(diffuseColor.rgb,secondaryPaint,paintMix);`);
      };
      material.customProgramCacheKey = () => 'blender-two-layer-paint-v1';
      material.needsUpdate = true;
    }
  });
  for (const data of settings.lights) {
    if (data.type !== 'AREA') continue;
    const matrix = new THREE.Matrix4().set(...data.matrix.flat()).premultiply(blenderToWeb);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);
    const width = Math.abs(scale.x) * data.size, height = Math.abs(scale.y) * data.size;
    const emission = data.tree?.nodes.find(n => n.type === 'EMISSION');
    const power = data.energy * (emission?.inputs.find(i => i.name === 'Strength')?.value ?? 1);
    const area = width * height * (data.shape === 'ELLIPSE' ? Math.PI / 4 : 1);
    // Integrate the source elliptical emitter with eight rectangular bands.
    // Cycles multiplies light strength (10) by its emission shader (900);
    // UV.Y drives a black-to-white ramp across the light's short axis.
    for (let band = 0; band < 8; band++) {
      const uv = (band + 0.5) / 8, y = uv * 2 - 1;
      const w = width * Math.sqrt(1 - y * y);
      const light = new THREE.RectAreaLight(new THREE.Color().fromArray(data.color), power * uv / (area * Math.PI), w, height / 8);
      light.position.copy(position).add(new THREE.Vector3(0, (uv - 0.5) * height, 0).applyQuaternion(quaternion));
      light.quaternion.copy(quaternion); scene.add(light);
    }
    // Shadow-only directional proxy for the fixed studio emitter. It adds no
    // illumination; direct area illumination is attenuated by this depth map.
    const shadow = new THREE.DirectionalLight(0xffffff, 0);
    shadow.position.copy(position);
    shadow.target.position.copy(position).add(new THREE.Vector3(0,0,-10).applyQuaternion(quaternion));
    shadow.castShadow = true;
    shadow.shadow.mapSize.set(2048, 2048);
    Object.assign(shadow.shadow.camera, { left:-45, right:45, top:45, bottom:-45, near:0.1, far:60 });
    shadow.shadow.bias = -0.00015;
    shadow.shadow.normalBias = 0.025;
    shadow.shadow.camera.updateProjectionMatrix();
    scene.add(shadow,shadow.target);
  }
  configureStudioShadows(scene);
}
export function configureStudioShadows(scene) {
  const shadowMaterials = new Set();
  scene.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    object.castShadow = !materials.some(m => m.transmission > 0);
    object.receiveShadow = true;
    for (const material of materials) {
      if (shadowMaterials.has(material)) continue;
      shadowMaterials.add(material);
      const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n float studioShadow=mix(0.35,1.0,getShadowMask()); reflectedLight.directDiffuse*=studioShadow; reflectedLight.directSpecular*=studioShadow;');
      };
      material.customProgramCacheKey = () => key + '-studio-shadow-v1';
      material.needsUpdate = true;
    }
  });
}
export async function createPipeline(renderer, scene, camera, assets) {
  const lut = await new THREE.TextureLoader().loadAsync(new URL('filmic-lut.png', assets).href);
  lut.colorSpace = THREE.NoColorSpace;
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.generateMipmaps = false;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const render = new RenderPass(scene, camera);
  composer.addPass(render);
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 0.6, thickness: 1, distanceExponent: 2, samples: 16 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  const display = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, lut: { value: lut } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D lut; varying vec2 vUv;
      vec3 sampleSlice(vec3 p, float slice) { return texture2D(lut, vec2((slice * 64.0 + p.r * 63.0 + 0.5) / 4096.0, (p.g * 63.0 + 0.5) / 64.0)).rgb; }
      void main(){ vec3 c=max(texture2D(tDiffuse,vUv).rgb,vec3(0.0));
        vec3 p=clamp((log2(max(c,vec3(0.0000152587890625)))+16.0)/32.0,0.0,1.0); float z=p.b*63.0;
        gl_FragColor=vec4(mix(sampleSlice(p,floor(z)),sampleSlice(p,min(63.0,floor(z)+1.0)),fract(z)),1.0); }`,
  });
  composer.addPass(display);
  const antialias = new SMAAPass();
  composer.addPass(antialias);
  return { composer, dispose() { lut.dispose(); ao.dispose(); render.dispose(); display.dispose(); antialias.dispose(); composer.dispose(); } };
}
