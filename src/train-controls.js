import { Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Keep the camera's composition, while rotating its position and viewing ray
// about the train origin instead of the current (possibly panned) look-at point.
export class TrainOrbitControls extends OrbitControls {
  update(deltaTime) {
    if (!this.orbitRoot) return super.update(deltaTime);
    const rotation = this.object.quaternion.clone();
    const target = this.target.clone();
    const changed = super.update(deltaTime);
    const delta = new Quaternion().copy(this.object.quaternion).multiply(rotation.invert());
    if (delta.x * delta.x + delta.y * delta.y + delta.z * delta.z > 1e-24) {
      const offset = this.orbitRoot.getWorldPosition(new Vector3()).sub(target);
      const correction = offset.clone().sub(offset.applyQuaternion(delta));
      this.object.position.add(correction);
      this.target.add(correction);
      this.object.updateMatrixWorld();
    }
    return changed;
  }
}

