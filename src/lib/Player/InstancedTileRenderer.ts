import * as THREE from 'three';

const MAX_INSTANCES = 8000;

interface PoolEntry {
    mesh: THREE.InstancedMesh;
    bgColorAttr: THREE.InstancedBufferAttribute;
}

export interface TileInstanceData {
    shapeKey: string;
    x: number;
    y: number;
    z: number;
    rotation: number; // radians
    scale: number;
    color: string;
    bgColor: string;
}

/**
 * GPU Instanced Tile Renderer
 * 
 * Replaces per-tile Mesh draw calls (N draw calls) with a single
 * InstancedMesh draw call per geometry type (~1-10 draw calls total).
 */
export class InstancedTileRenderer {
    private pool = new Map<string, PoolEntry>();
    private scene: THREE.Scene;

    // Reusable temp objects to avoid GC pressure
    private _matrix = new THREE.Matrix4();
    private _position = new THREE.Vector3();
    private _quaternion = new THREE.Quaternion();
    private _scale = new THREE.Vector3();
    private _euler = new THREE.Euler();
    private _color = new THREE.Color();

    private _lastUsedKeys = new Set<string>();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    /**
     * Update all visible tiles. Groups by shapeKey, updates instance matrices/colors.
     */
    update(
        tiles: TileInstanceData[],
        geometryCache: Map<string, THREE.BufferGeometry>
    ): void {
        // Group by shapeKey
        const groups = new Map<string, TileInstanceData[]>();
        for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            let group = groups.get(t.shapeKey);
            if (!group) {
                group = [];
                groups.set(t.shapeKey, group);
            }
            group.push(t);
        }

        const currentUsedKeys = new Set<string>();

        for (const [shapeKey, group] of groups) {
            currentUsedKeys.add(shapeKey);
            const baseGeometry = geometryCache.get(shapeKey);
            if (!baseGeometry) continue;

            const entry = this.getOrCreateEntry(shapeKey, baseGeometry);
            const count = Math.min(group.length, MAX_INSTANCES);

            for (let i = 0; i < count; i++) {
                const t = group[i];

                // Set instance matrix
                this._position.set(t.x, t.y, t.z);
                this._euler.set(0, 0, t.rotation);
                this._quaternion.setFromEuler(this._euler);
                this._scale.set(t.scale, t.scale, t.scale);
                this._matrix.compose(this._position, this._quaternion, this._scale);
                entry.mesh.setMatrixAt(i, this._matrix);

                // Set main color via setColorAt (Three.js handles USE_INSTANCING_COLOR define)
                this._color.set(t.color);
                entry.mesh.setColorAt(i, this._color);

                // Set bg color (via custom instance attribute)
                this._color.set(t.bgColor);
                entry.bgColorAttr.setXYZ(i, this._color.r, this._color.g, this._color.b);
            }

            entry.mesh.count = count;
            entry.mesh.instanceMatrix.needsUpdate = true;
            if (entry.mesh.instanceColor) {
                entry.mesh.instanceColor.needsUpdate = true;
            }
            entry.bgColorAttr.needsUpdate = true;
        }

        // Hide meshes that are no longer needed
        for (const key of this._lastUsedKeys) {
            if (!currentUsedKeys.has(key)) {
                const entry = this.pool.get(key);
                if (entry) entry.mesh.count = 0;
            }
        }
        this._lastUsedKeys = currentUsedKeys;
    }

    /**
     * Get or create an InstancedMesh entry for a geometry shapeKey.
     */
    private getOrCreateEntry(
        shapeKey: string,
        baseGeometry: THREE.BufferGeometry
    ): PoolEntry {
        let entry = this.pool.get(shapeKey);
        if (entry) return entry;

        // Clone geometry so each entry has independent instanced attributes
        const geometry = baseGeometry.clone();

        // Per-instance background color attribute
        const bgColors = new Float32Array(MAX_INSTANCES * 3);
        const bgColorAttr = new THREE.InstancedBufferAttribute(bgColors, 3);
        bgColorAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aInstanceBgColor', bgColorAttr);

        // Use a custom ShaderMaterial that reads instanceColor + aInstanceBgColor + vertex color
        const material = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: `
                attribute vec3 aInstanceBgColor;
                varying vec3 vMask;
                varying vec3 vBgColor;

                void main() {
                    vMask = color;
                    vBgColor = aInstanceBgColor;
                    
                    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vMask;
                varying vec3 vBgColor;

                void main() {
                    // instanceColor is automatically available in InstancedMesh with setColorAt
                    vec3 finalColor = mix(vBgColor, instanceColor, vMask.r);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            vertexColors: true,
            side: THREE.DoubleSide,
            // Force Three.js to enable USE_INSTANCING for instanceMatrix
            // instanceColor is managed by Three.js internally via setColorAt
        });

        const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
        mesh.count = 0;
        mesh.frustumCulled = false;

        this.scene.add(mesh);

        entry = { mesh, bgColorAttr };
        this.pool.set(shapeKey, entry);
        return entry;
    }

    /**
     * Get the number of active draw calls (non-hidden instanced meshes)
     */
    getDrawCallCount(): number {
        let count = 0;
        for (const [, entry] of this.pool) {
            if (entry.mesh.count > 0) count++;
        }
        return count;
    }

    /**
     * Remove all instanced meshes from the scene (without disposing resources)
     * Called when switching from instanced to legacy rendering
     */
    clearScene(): void {
        for (const [, entry] of this.pool) {
            entry.mesh.visible = false;
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        for (const [, entry] of this.pool) {
            this.scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            if (Array.isArray(entry.mesh.material)) {
                entry.mesh.material.forEach(m => m.dispose());
            } else {
                entry.mesh.material.dispose();
            }
            entry.mesh.dispose();
        }
        this.pool.clear();
        this._lastUsedKeys.clear();
    }
}
