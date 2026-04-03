import * as THREE from 'three';
import {WebGPURenderer} from 'three/webgpu';
import { IPlayer, ILevelData, IMusic, TargetFramerateType } from './types';
import { Planet } from './Planet';
import { HitsoundManager, HitsoundType } from './HitsoundManager';
import { BloomEffect } from './BloomEffect';
import { FlashEffect } from './FlashEffect';
import createTrackMesh from '../Geo/mesh_reserve';
import { getWorkerManager, disposeWorkerManager } from '../Geo/tileWorkerManager';
import { EasingFunctions } from './Easing';
import { HTMLAudioMusic, getSharedAudioContext } from './HTMLAudioMusic';
import { TileColorManager, isEventActive, TileColorConfig } from './TileColorManager';
import { CameraController, CameraTimelineEntry } from './CameraController';
import { DecorationManager } from './DecorationManager';
import { MoveTrackManager } from './MoveTrackManager';
import { PositionTrackManager } from './PositionTrackManager';
import { InstancedTileRenderer, TileInstanceData } from './InstancedTileRenderer';
import Stats from 'three/examples/jsm/libs/stats.module.js';

function logMem(tag: string) {
  const mem = (performance as any).memory;
  if (mem) {
    const used = (mem.usedJSHeapSize / 1024 / 1024).toFixed(1);
    const total = (mem.totalJSHeapSize / 1024 / 1024).toFixed(1);
    const limit = (mem.jsHeapSizeLimit / 1024 / 1024).toFixed(1);
    console.log(`[MEM] ${tag} | used: ${used}MB / total: ${total}MB / limit: ${limit}MB`);
  } else {
    console.log(`[MEM] ${tag} (performance.memory unavailable)`);
  }
}

export class Player implements IPlayer {
  private container: HTMLElement | null = null;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer | WebGPURenderer;
  private rendererType: 'webgl' | 'webgpu' = 'webgpu';
  private renderMethod: 'sync' | 'async' = 'sync';
  private showTrail: boolean = false;
  private useWorker: boolean = true;
  private targetFramerate: TargetFramerateType = 'auto';
  private animationId: number | null = null;
  private lastFrameTime: number = 0;
  private frameInterval: number = 0; // milliseconds between frames
  private stats: Stats | null = null;
  
  private levelData: ILevelData;
  private planetRed: Planet | null = null;
  private planetBlue: Planet | null = null;
  private currentPivotPosition: { x: number; y: number } = { x: 0, y: 0 };

  // Tile Management
  private tiles: Map<string, THREE.Mesh> = new Map();
  private visibleTiles: Set<string> = new Set();
  private tileLimit: number = 0; // 0 means no limit? Or use a sensible default
  
  // Spatial indexing for fast visibility checks
  private spatialGrid: Map<number, number[]> = new Map();
  private spatialGridSize: number = 5; // Grid cell size in world units
  
  // Shared decoration geometries and materials (prevent creating new ones for each tile)
  private sharedDecoGeometry: THREE.CircleGeometry | null = null;
  private sharedTwirlMaterial: THREE.MeshBasicMaterial | null = null;
  private sharedSpeedUpMaterial: THREE.MeshBasicMaterial | null = null;
  private sharedSpeedDownMaterial: THREE.MeshBasicMaterial | null = null;
  
  // Hitsound
  private hitsoundManager: HitsoundManager;
  
  // Playback state
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private startTime: number = 0;
  private pauseTime: number = 0;
  private elapsedTime: number = 0;
  private musicStartDelay: number = 0; // Music start delay in seconds
  private hitsoundStartDelay: number = 0; // Hitsound start delay in seconds
  
  private currentTileIndex: number = 0;
  
  // Camera settings
  private zoom: number = 1;
  private zoomMultiplier: number = 1.0;
  private cameraPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  
  // Interaction state
  private isDragging: boolean = false;
  private previousMousePosition: { x: number; y: number } = { x: 0, y: 0 };
  private initialPinchDistance: number = 0;
  private initialZoom: number = 0;
  
  private boundHandlers: { [key: string]: EventListenerOrEventListenerObject } = {};

  // Stats callback
  private onStatsUpdate: ((stats: { fps: number; time: number; tileIndex: number }) => void) | null = null;
  private frameCount: number = 0;
  private lastTime: number = 0;

  // Precalculated rotations and timing
  private cumulativeRotations: number[] = [];
  private totalLevelRotation: number = 0;
  
  private tileStartTimes: number[] = [];
  private tileDurations: number[] = [];
  private tileExtraRotations: number[] = [];
  private tileIsCW: boolean[] = [];
  private tileBPM: number[] = [];
  private tileStartAngle: number[] = [];
  private tileStickToFloors: boolean[] = []; // Whether planet follows each tile
  private tileTotalAngle: number[] = [];
  private tileStartDist: number[] = [];
  private tileEndDist: number[] = [];
  private tileEvents: Map<number, any[]> = new Map();
  private tileCameraEvents: Map<number, any[]> = new Map();
  private tileMoveTrackEvents: Map<number, any[]> = new Map();

  // Camera Controller
  private cameraController: CameraController;
  
  // Tile Color Manager
  private tileColorManager: TileColorManager;
  
  // Decoration Manager
  private decorationManager: DecorationManager | null = null;

  // MoveTrack Manager
  private moveTrackManager: MoveTrackManager | null = null;

  // PositionTrack Manager
  private positionTrackManager: PositionTrackManager | null = null;
  private isEditorMode: boolean = false; // Whether we're in editor preview mode

  // GPU Instanced Rendering
  private instancedRenderer: InstancedTileRenderer | null = null;
  private useInstancing: boolean = false; // Disabled by default until verified working

  // Lock Camera
  private lockCamera: boolean = false;

  // Bloom Effect
  private bloomEffect: BloomEffect | null = null;
  private bloomEnabled: boolean = false;
  private bloomThreshold: number = 50;
  private bloomIntensity: number = 100;
  private bloomColor: string = 'ffffff';
  private bloomTimeline: { time: number; event: any }[] = [];
  private lastBloomTimelineIndex: number = -1;
  
  // Flash Effect
  private flashEffect: FlashEffect | null = null;
  private flashTimeline: { time: number; event: any }[] = [];
  private lastFlashTimelineIndex: number = -1;
  
  // Recolor Track
  private recolorTimeline: { time: number; event: any }[] = [];
  private lastRecolorTimelineIndex: number = -1;
  
  // Custom Background (SetCustomBG event)
  private customBGTimeline: { time: number; event: any }[] = [];
  private lastCustomBGTimelineIndex: number = -1;
  private customBGMesh: THREE.Mesh | null = null;
  private customBGTexture: THREE.Texture | null = null;
  private customBGImages: Map<string, string> = new Map(); // filename -> URL
  
  // Shared Renderer Resources
  private sharedTileMaterial: THREE.ShaderMaterial | null = null;
  private geometryCache: Map<string, THREE.BufferGeometry> = new Map();
  private maxCachedTiles: number = 2000; // Only keep this many meshes in memory

  // Video Background
  private videoElement: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private videoMesh: THREE.Mesh | null = null;
  private videoOffset: number = 0; // ms

  // Render target for post-processing
  private renderTarget: THREE.WebGLRenderTarget | null = null;

  // Renderer state
  private isRestoringContext: boolean = false;
  private webgpuSupported: boolean | null = null; // null = not checked, true = supported, false = not supported
  private rendererInitialized: boolean = false;

  private music: IMusic = new HTMLAudioMusic();

  constructor(levelData: ILevelData, rendererType: 'webgl' | 'webgpu' = 'webgpu') {
    this.rendererType = rendererType;
    this.levelData = levelData;
    
    logMem('=== CONSTRUCTOR START === | tiles: ' + (levelData.tiles?.length ?? 0) + ' actions: ' + (levelData.actions?.length ?? 0) + ' n/angleData: ' + ((levelData as any).n?.length ?? levelData.angleData?.length ?? 0));
    
    // Initialize camera from settings
    this.cameraController = new CameraController(levelData, [], []);
    this.cameraController.resetCameraState();
    
    // Initialize tile color manager
    this.tileColorManager = new TileColorManager(levelData);

    // Calculate basic tile positions (without PositionTrack) first
    // This is needed because we skipped ADOFAI-JS's calculateTilePosition()
    this.calculateBasicTilePositions();

    // Parse actions if available
    // For large files (>500K tiles), skip tileEvents Map to save memory.
    // Actions are already available via tiles[i].actions.
    const isLargeLevel = (this.levelData.tiles?.length ?? 0) > 500000;
    logMem('Before action parsing | actions: ' + (this.levelData.actions?.length ?? 0) + ' isLarge: ' + isLargeLevel);
    if (this.levelData.actions) {
      this.levelData.actions.forEach(action => {
        const floor = action.floor;
        if (action.eventType === 'MoveCamera') {
            if (!this.tileCameraEvents.has(floor)) {
                this.tileCameraEvents.set(floor, []);
            }
            this.tileCameraEvents.get(floor)!.push(action);
        } else if (action.eventType === 'MoveTrack') {
            if (!this.tileMoveTrackEvents.has(floor)) {
                this.tileMoveTrackEvents.set(floor, []);
            }
            this.tileMoveTrackEvents.get(floor)!.push(action);
        } else if (!isLargeLevel) {
            // Skip tileEvents Map for large files — use getTileEventsForFloor() instead
            if (!this.tileEvents.has(floor)) {
                this.tileEvents.set(floor, []);
            }
            this.tileEvents.get(floor)!.push(action);
        }
      });
    }
    logMem('After action parsing | tileEvents: ' + this.tileEvents.size + ' cameraEvents: ' + this.tileCameraEvents.size + ' moveTrackEvents: ' + this.tileMoveTrackEvents.size);

    // Initialize HitsoundManager
    // If hitsound is "None" or empty, default to "Kick"
    const rawHitsound = this.levelData.settings?.hitsound;
    const hitsoundType = (!rawHitsound || rawHitsound === 'None' ? 'Kick' : rawHitsound) as HitsoundType;
    const hitsoundVolume = this.levelData.settings?.hitsoundVolume ?? 100;
    console.log('[Player] Initializing HitsoundManager with type:', hitsoundType, 'volume:', hitsoundVolume, '(raw:', rawHitsound, ')');
    this.hitsoundManager = new HitsoundManager(hitsoundType, hitsoundVolume);
    logMem('After HitsoundManager init');

    // Initialize Three.js components
    this.scene = new THREE.Scene();
    
    // Set background color from level settings
    const bgColor = this.levelData.settings?.backgroundColor || '000000';
    this.scene.background = new THREE.Color(this.formatHexColor(bgColor));
    
    // Initialize video settings
    this.videoOffset = this.levelData.settings?.vidOffset || 0;

    // Append extra tile at the end
    logMem('Before appendExtraTile | tiles: ' + this.levelData.tiles.length);
    this.appendExtraTile();
    logMem('After appendExtraTile | tiles: ' + this.levelData.tiles.length);

    // Re-initialize position track manager with updated tiles (including extra tile)
    // Reuse the existing instance instead of creating a new one
    console.log('[Player] Creating PositionTrackManager...');
    logMem('Before PositionTrackManager');
    this.positionTrackManager = new PositionTrackManager(levelData);
    logMem('After PositionTrackManager | posEvents: ' + (this.positionTrackManager as any).positionTrackEvents?.size);

    // Update levelData.tiles with final positions (including PositionTrack offsets)
    console.log('[Player] Calculating all tile transforms...');
    logMem('Before calculateAllTileTransforms');
    const allTransforms = this.positionTrackManager.calculateAllTileTransforms(this.isEditorMode);
    logMem('After calculateAllTileTransforms | transformCount: ' + allTransforms.length);
    console.log('[Player] Updating tile positions...');
    for (let i = 0; i < this.levelData.tiles.length; i++) {
      const transform = allTransforms[i];
      if (transform) {
        this.levelData.tiles[i].position = [transform.position.x, transform.position.y];
      }
    }
    logMem('After tile position update');

    // Initialize tile colors from settings (now after appendExtraTile)
    console.log('[Player] initTileColors...');
    this.tileColorManager.initTileColors();
    logMem('After initTileColors');

    // Calculate cumulative rotations
    console.log('[Player] calculateCumulativeRotations...');
    logMem('Before calculateCumulativeRotations');
    this.calculateCumulativeRotations();
    logMem('After calculateCumulativeRotations');
    
    // Update camera controller with calculated values
    this.cameraController = new CameraController(levelData, this.tileStartTimes, this.tileBPM);
    this.cameraController.resetCameraState();
    
    // Build Camera Timeline
    this.cameraController.buildCameraTimeline(this.tileCameraEvents);
    
    // Build Bloom Timeline
    this.buildBloomTimeline();
    
    // Build CustomBG Timeline
    this.buildCustomBGTimeline();

    // Build CustomBG Timeline
    this.buildCustomBGTimeline();

    // Initialize Decoration Manager
    this.decorationManager = new DecorationManager(
      this.scene,
      this.levelData,
      this.tileStartTimes,
      this.tileBPM
    );
    this.decorationManager.init();

    // Initialize MoveTrack Manager
    this.moveTrackManager = new MoveTrackManager(
      this.levelData,
      this.tileStartTimes,
      this.tileBPM
    );
    this.moveTrackManager.initializeMoveTrackEvents(this.tileMoveTrackEvents);
    this.moveTrackManager.setTilesReference(this.tiles);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040, 1.0);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(10, 10, 15);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);
    
    // Default camera setup - will be updated on resize/init
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
    this.camera.position.z = 10;
    this.scene.add(this.camera);
    
    this.initRenderer();
    
    // Initialize shared decoration resources
    this.initSharedDecorationResources();

    // Initialize GPU instanced renderer
    this.instancedRenderer = new InstancedTileRenderer(this.scene);
    console.log('[Player] GPU Instanced rendering enabled');
    
    // Build spatial index for fast visibility checks
    console.log('[Player] buildSpatialIndex...');
    logMem('Before buildSpatialIndex');
    this.buildSpatialIndex();
    logMem('After buildSpatialIndex | spatialGrid: ' + this.spatialGrid.size + ' entries');
    
    logMem('=== CONSTRUCTOR COMPLETE ===');
    // Hitsounds will be synthesized during loading process with progress display
  }

  /**
   * Get events for a specific floor/tile.
   * For large files, reads directly from tiles[i].actions (no Map allocation).
   * For small files, uses the pre-parsed tileEvents Map.
   */
  private getTileEventsForFloor(floor: number): any[] {
    if (this.tileEvents.size > 0) {
      return this.tileEvents.get(floor) || [];
    }
    // Fallback: read from tile actions, filtering out camera/moveTrack events
    const tile = this.levelData.tiles[floor];
    if (!tile || !tile.actions) return [];
    // Return the actions array directly (it's already filtered by ADOFAI-JS to not include floor property issues)
    // We need to filter out MoveCamera and MoveTrack since those are handled separately
    const result: any[] = [];
    for (let i = 0; i < tile.actions.length; i++) {
      const a = tile.actions[i];
      if (a.eventType !== 'MoveCamera' && a.eventType !== 'MoveTrack') {
        result.push(a);
      }
    }
    return result;
  }

  /**
   * Iterate all tile events, calling callback(floor, events[]).
   * For large files, iterates tiles directly (no Map needed).
   */
  private iterateTileEvents(callback: (floor: number, events: any[]) => void): void {
    if (this.tileEvents.size > 0) {
      this.tileEvents.forEach((events, floor) => callback(floor, events));
    } else {
      // Iterate through tiles that have actions
      const tiles = this.levelData.tiles;
      for (let i = 0; i < tiles.length; i++) {
        const actions = tiles[i]?.actions;
        if (actions && actions.length > 0) {
          // Filter out MoveCamera and MoveTrack
          const filtered: any[] = [];
          for (let j = 0; j < actions.length; j++) {
            const a = actions[j];
            if (a.eventType !== 'MoveCamera' && a.eventType !== 'MoveTrack') {
              filtered.push(a);
            }
          }
          if (filtered.length > 0) {
            callback(i, filtered);
          }
        }
      }
    }
  }

  private formatHexColor(hex: string): string {
    return this.tileColorManager.formatHexColor(hex);
  }
  
  /**
   * Pre-synthesize hitsounds at level load time (called during initialization)
   */
  private async preSynthesizeHitsounds(): Promise<void> {
    console.log('[Player] preSynthesizeHitsounds called');
    console.log('[Player] preSynthesizeHitsounds called');
    if (!this.tileStartTimes || this.tileStartTimes.length === 0) {
      console.log('[Player] No tileStartTimes, skipping hitsound synthesis');
      return;
    }
    
    // Calculate total duration (last tile time + some buffer)
    const lastTileTime = this.tileStartTimes[this.tileStartTimes.length - 1] || 0;
    const totalDuration = lastTileTime + 10; // Add 10 seconds buffer
    
    // Collect all hitsound timestamps
    const hitsoundTimestamps: number[] = [];
    // tileStartTimes[1] = 0 (after shift)
    // tileStartTimes[i] = time from tile 1 to tile i (in seconds)
    // When elapsedTime = tileStartTimes[i], the ball hits tile i+1
    // Music.currentTime at that time = offset + tileStartTimes[i]
    const offset = (this.levelData.settings.offset || 0) / 1000; // Used for music timing
    const firstTileOffset = this.tileStartTimes.length > 0 ? this.tileStartTimes[0] : 0;
    console.log('[Player] preSynthesizeHitsounds - offset:', offset, 'firstTileOffset:', firstTileOffset, 'tileStartTimes[1]:', this.tileStartTimes[1]);
    for (let i = 1; i < this.tileStartTimes.length; i++) {
        const t = this.tileStartTimes[i];
        const tile = this.levelData.tiles[i];
        if (tile && tile.angle !== 0) {
            // Timestamp is the elapsed time when this tile is hit (in seconds)
            hitsoundTimestamps.push(t);
        }
    }
    
    console.log('[Player] preSynthesizeHitsounds - Hitsound timestamps count:', hitsoundTimestamps.length, 'total duration:', totalDuration);
    console.log('[Player] preSynthesizeHitsounds - Hitsound timestamps (first 5):', hitsoundTimestamps.slice(0, 5));
    
    // Pre-synthesize (no progress callback for private method)
    await this.hitsoundManager.preSynthesize(hitsoundTimestamps, totalDuration);
  }
  
  /**
   * Pre-synthesize hitsounds with progress callback (public method for UI)
   * @param onProgress Progress callback (0-100)
   */
  public async preSynthesizeHitsoundsWithProgress(onProgress?: (percent: number) => void): Promise<void> {
    console.log('[Player] preSynthesizeHitsoundsWithProgress called');
    
    // Check if hitsounds are disabled or set to None
    if (!this.hitsoundManager.isEnabled() || this.hitsoundManager.getHitsoundType() === 'None') {
      console.log('[Player] Hitsounds disabled or set to None, skipping synthesis');
      if (onProgress) onProgress(100);
      return;
    }
    
    if (!this.tileStartTimes || this.tileStartTimes.length === 0) {
      console.log('[Player] No tileStartTimes, skipping hitsound synthesis');
      return;
    }
    
    // Calculate total duration (last tile time + some buffer)
    const lastTileTime = this.tileStartTimes[this.tileStartTimes.length - 1] || 0;
    const totalDuration = lastTileTime + 10; // Add 10 seconds buffer
    
    // Collect all hitsound timestamps
    const hitsoundTimestamps: number[] = [];
    // tileStartTimes[1] = 0 (after shift)
    // tileStartTimes[i] = time from tile 1 to tile i
    // When elapsedTime = tileStartTimes[i], the ball hits tile i+1
    // Music.currentTime at that time = offset + tileStartTimes[i]
    const offset = (this.levelData.settings.offset || 0) / 1000; // Used for music timing
    const firstTileOffset = this.tileStartTimes.length > 0 ? this.tileStartTimes[0] : 0;
    console.log('[Player] preSynthesizeHitsoundsWithProgress - offset:', offset, 'firstTileOffset:', firstTileOffset, 'tileStartTimes[1]:', this.tileStartTimes[1]);
    for (let i = 1; i < this.tileStartTimes.length; i++) {
        const t = this.tileStartTimes[i];
        const tile = this.levelData.tiles[i];
        if (tile && tile.angle !== 0) {
            // Timestamp is the elapsed time when this tile is hit (in seconds)
            hitsoundTimestamps.push(t);
        }
    }
    
    console.log('[Player] preSynthesizeHitsoundsWithProgress - Hitsound timestamps count:', hitsoundTimestamps.length, 'total duration:', totalDuration);
    console.log('[Player] preSynthesizeHitsoundsWithProgress - Hitsound timestamps (first 5):', hitsoundTimestamps.slice(0, 5));
    
    // Pre-synthesize (no progress callback for private method)
    await this.hitsoundManager.preSynthesize(hitsoundTimestamps, totalDuration);
  }
  
  /**
   * Build spatial index for fast visibility checks
   * Groups tiles into grid cells for O(1) lookup
   */
  private buildSpatialIndex(): void {
    this.spatialGrid.clear();
    const tiles = this.levelData.tiles;
    if (!tiles) return;
    
    console.log('[SpatialIndex] Building for', tiles.length, 'tiles...');
    const gridSize = this.spatialGridSize;
    const SPATIAL_LOG_INTERVAL = 1000000;
    for (let i = 0; i < tiles.length; i++) {
      if (i % SPATIAL_LOG_INTERVAL === 0 && i > 0) {
        const mem = (performance as any).memory;
        const usedMB = mem ? (mem.usedJSHeapSize / 1024 / 1024).toFixed(1) : '?';
        console.log(`[SpatialIndex] Progress: ${i}/${tiles.length} | gridCells: ${this.spatialGrid.size} | mem: ${usedMB}MB`);
      }
      const pos = tiles[i].position;
      const cellX = Math.floor(pos[0] / gridSize);
      const cellY = Math.floor(pos[1] / gridSize);
      const key = cellX * 100000 + cellY; 
      
      let list = this.spatialGrid.get(key);
      if (list === undefined) {
        list = [];
        this.spatialGrid.set(key, list);
      }
      list.push(i);
    }
  }
  
  private appendExtraTile(): void {
    const tiles = this.levelData.tiles;
    if (!tiles || tiles.length === 0) return;

    const lastTile = tiles[tiles.length - 1];
    
    // Determine length from last segment if possible
    let length = 1.0; 
    if (tiles.length > 1) {
       for (let i = tiles.length - 1; i > 0; i--) {
           const cur = tiles[i];
           const prev = tiles[i-1];
           const dx = cur.position[0] - prev.position[0];
           const dy = cur.position[1] - prev.position[1];
           const dist = Math.sqrt(dx*dx + dy*dy);
           if (dist > 0.01) {
               length = dist;
               break;
           }
       }
    }
    
    // Direction (absolute angle in degrees)
    const direction = lastTile.direction !== undefined ? lastTile.direction : 0;
    const rad = (direction * Math.PI) / 180;
    const newX = lastTile.position[0] + Math.cos(rad) * length;
    const newY = lastTile.position[1] + Math.sin(rad) * length;
    
    const newTile = {
        ...lastTile,
        position: [newX, newY],
        angle: 180,
        direction: direction,
        index: tiles.length
    };
    
    tiles.push(newTile);
  }

  private calculateCumulativeRotations(): void {
    const tiles = this.levelData.tiles;
    if (!tiles || tiles.length === 0) return;

    const n = tiles.length;
    console.log('[CalcRot] Allocating 11 arrays for', n, 'tiles...');
    this.cumulativeRotations = new Array(n);
    this.tileStartTimes = new Array(n);
    this.tileDurations = new Array(n - 1);
    this.tileExtraRotations = new Array(n);
    this.tileIsCW = new Array(n);
    this.tileBPM = new Array(n);
    this.tileStartAngle = new Array(n - 1);
    this.tileTotalAngle = new Array(n - 1);
    this.tileStartDist = new Array(n - 1);
    this.tileEndDist = new Array(n - 1);
    this.tileStickToFloors = new Array(n);
    logMem('CalcRot: After array allocation');
    
    // Initialize tileStickToFloors from PositionTrackManager
    if (this.positionTrackManager) {
      const allTransforms = this.positionTrackManager.calculateAllTileTransforms(this.isEditorMode);
      for (let i = 0; i < n; i++) {
        const transform = allTransforms[i];
        this.tileStickToFloors[i] = transform?.stickToFloors ?? (this.levelData.settings?.stickToFloors !== false);
      }
    } else {
      // Default to true if no PositionTrackManager
      for (let i = 0; i < n; i++) {
        this.tileStickToFloors[i] = this.levelData.settings?.stickToFloors !== false;
      }
    }
    logMem('CalcRot: After stickToFloors init');
    
    this.cumulativeRotations[0] = 0;
    this.tileStartTimes[0] = 0;
    
    let totalRotation = 0;
    let totalTime = 0;
    
    // Initial settings
    let currentBPM = this.levelData.settings.bpm || 100;
    let isCW = true;

    // We iterate through tiles to calculate the rotation/time to reach the NEXT tile.
    console.log('[CalcRot] Starting main loop for', n - 1, 'iterations...');
    const ROT_LOG_INTERVAL = 1000000;
    for (let i = 0; i < n - 1; i++) {
        if (i % ROT_LOG_INTERVAL === 0 && i > 0) {
            const mem = (performance as any).memory;
            const usedMB = mem ? (mem.usedJSHeapSize / 1024 / 1024).toFixed(1) : '?';
            console.log(`[CalcRot] Progress: ${i}/${n-1} | mem: ${usedMB}MB`);
        }
        // Process events for current tile
        let extraRotation = 0;
        const events = this.getTileEventsForFloor(i);
        if (events) {
            for (let j = 0; j < events.length; j++) {
                const event = events[j];
                if (!isEventActive(event)) continue;
                
                if (event.eventType === 'Twirl') {
                    isCW = !isCW;
                } else if (event.eventType === 'SetSpeed') {
                    if (event.speedType === 'Multiplier') {
                        currentBPM *= event.bpmMultiplier;
                    } else {
                        currentBPM = event.beatsPerMinute;
                    }
                } else if (event.eventType === 'Pause') {
                    extraRotation += (event.duration || 0) / 2.0;
                }
            }
        }
        
        this.tileIsCW[i] = isCW;
        this.tileBPM[i] = currentBPM;
        
        const pivot = tiles[i];
        const next = tiles[i + 1];

        let startAngle = 0;
        if (i === 0) {
            startAngle = ((this.levelData.settings.rotation || 0) + 180) * Math.PI / 180;
        } else {
            const prev = tiles[i - 1];
            startAngle = Math.atan2(prev.position[1] - pivot.position[1], prev.position[0] - pivot.position[0]);
        }

        const relativeAngle = (pivot.angle !== undefined) ? pivot.angle : 180;
        let totalAngle = (relativeAngle * Math.PI) / 180;
        if (isCW) totalAngle = -totalAngle;

        if (isCW) totalAngle -= extraRotation * 2 * Math.PI;
        else totalAngle += extraRotation * 2 * Math.PI;

        const rotationAmount = Math.abs(totalAngle) / (2 * Math.PI);
        const duration = (rotationAmount * 2) * (60 / currentBPM);
        
        totalRotation += rotationAmount;
        totalTime += duration;
        
        this.tileStartAngle[i] = startAngle;
        this.tileTotalAngle[i] = totalAngle;
        
        let startDist = 1.0;
        if (i > 0) {
            const prev = tiles[i - 1];
            const pdx = prev.position[0] - pivot.position[0];
            const pdy = prev.position[1] - pivot.position[1];
            startDist = Math.sqrt(pdx*pdx + pdy*pdy);
        }
        this.tileStartDist[i] = startDist;
        
        const edx = next.position[0] - pivot.position[0];
        const edy = next.position[1] - pivot.position[1];
        this.tileEndDist[i] = Math.sqrt(edx*edx + edy*edy);

        this.cumulativeRotations[i+1] = totalRotation;
        this.tileDurations[i] = duration;
        this.tileExtraRotations[i] = extraRotation;
        this.tileStartTimes[i+1] = totalTime;
    }
    
    // Shift all tileStartTimes so that tileStartTimes[1] is 0
    if (n > 1) {
        const shift = this.tileStartTimes[1];
        for (let i = 0; i < n; i++) {
             this.tileStartTimes[i] -= shift;
        }
    }
    
    // Handle the last tile
    if (n > 0) {
        const lastIndex = n - 1;
        let extraRotation = 0;
        const events = this.getTileEventsForFloor(lastIndex);
        if (events) {
            for (let j = 0; j < events.length; j++) {
                const event = events[j];
                if (!isEventActive(event)) continue;
                if (event.eventType === 'Twirl') isCW = !isCW;
                else if (event.eventType === 'SetSpeed') {
                    if (event.speedType === 'Multiplier') currentBPM *= event.bpmMultiplier;
                    else currentBPM = event.beatsPerMinute;
                } else if (event.eventType === 'Pause') {
                    extraRotation += (event.duration || 0) / 2.0;
                }
            }
        }
        this.tileIsCW[lastIndex] = isCW;
        this.tileBPM[lastIndex] = currentBPM;
        this.tileExtraRotations[lastIndex] = extraRotation;
    }
    
    this.totalLevelRotation = totalRotation;
  }

  private initRenderer(): void {
    // If already initialized and not switching, skip
    if (this.rendererInitialized && this.renderer) {
      return;
    }

    console.log('Initializing renderer (type:', this.rendererType, ')');

    // Clean up old renderer safely
    const oldRenderer = this.renderer;
    if (oldRenderer) {
      try {
        // Check if renderer is properly initialized before disposing
        const hasBackend = (oldRenderer as any).backend !== undefined && (oldRenderer as any).backend !== null;
        if (hasBackend || this.rendererType === 'webgl') {
          if (this.container && oldRenderer.domElement && oldRenderer.domElement.parentNode === this.container) {
            this.container.removeChild(oldRenderer.domElement);
          }
          oldRenderer.dispose();
        }
      } catch (e) {
        console.warn('Error disposing old renderer:', e);
      }
      this.renderer = null as any;
    }

    // Check WebGPU support only once
    if (this.webgpuSupported === null) {
      this.webgpuSupported = this.checkWebGPUSupport();
    }

    if (this.rendererType === 'webgpu' && this.webgpuSupported) {
      try {
        const gpuRenderer = new WebGPURenderer({ alpha: true, antialias: true });
        this.renderer = gpuRenderer;
        this.rendererInitialized = true;

        // Handle WebGPU device loss
        (gpuRenderer as any).init().then(() => {
          const device = (gpuRenderer as any).backend.device;
          if (device) {
            device.lost.then((info: any) => {
              console.warn('WebGPU device lost:', info.message);
              if (info.reason !== 'destroyed') {
                this.rendererInitialized = false;
                this.initRenderer();
              }
            });
          }
        }).catch((e: Error) => {
          console.warn('WebGPU initialization failed in init():', e);
        });
      } catch (e) {
        console.warn('WebGPU initialization failed, falling back to WebGL:', e);
        this.rendererType = 'webgl';
      }
    }
    
    // Create WebGL renderer if WebGPU not used
    if (!this.rendererInitialized) {
      if (this.rendererType === 'webgpu') {
        console.warn('WebGPU not supported, using WebGL');
        this.rendererType = 'webgl';
      }
      
      try {
        this.renderer = new THREE.WebGLRenderer({ 
          alpha: true, 
          antialias: true,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
        });
        this.rendererInitialized = true;
      } catch (e) {
        console.error('Failed to create WebGL renderer:', e);
        // Try with minimal settings
        try {
          this.renderer = new THREE.WebGLRenderer({ 
            alpha: false, 
            antialias: false,
          });
          this.rendererInitialized = true;
        } catch (e2) {
          console.error('Failed to create even basic WebGL renderer:', e2);
          return;
        }
      }
    }
    
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    // Initialize Bloom Effect (WebGL only)
    if (this.rendererType === 'webgl') {
      this.bloomEffect = new BloomEffect();
      this.flashEffect = new FlashEffect();
    }
    
    // Handle WebGL context loss (only add once)
    if (this.rendererType === 'webgl' && !this.isRestoringContext) {
      const canvas = this.renderer.domElement;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        console.warn('WebGL context lost, will attempt to restore...');
        this.isRestoringContext = true;
        this.rendererInitialized = false;
      }, false);
      
      canvas.addEventListener('webglcontextrestored', () => {
        console.log('WebGL context restored');
        this.isRestoringContext = false;
        // Next render frame will trigger re-initialization via initRenderer
        this.onWindowResize();
      }, false);
    }
    
    // If container exists (runtime switch), re-attach
    if (this.container) {
      this.container.appendChild(this.renderer.domElement);
      this.onWindowResize();
    }
  }

  /**
   * Check if WebGPU is supported
   */
  private checkWebGPUSupport(): boolean {
    // Check for WebGPU API
    if (!navigator.gpu) {
      return false;
    }
    
    // Try to get adapter
    try {
      // This is async in reality, but we'll do a basic check
      // The actual adapter request will happen when WebGPURenderer is created
      return true;
    } catch {
      return false;
    }
  }

  public setRenderer(type: 'webgl' | 'webgpu'): void {
    if (this.rendererType === type) return;
    this.rendererType = type;
    this.rendererInitialized = false;
    this.initRenderer();
  }

  public setRenderMethod(method: 'sync' | 'async'): void {
    this.renderMethod = method;
  }

  public setShowTrail(show: boolean): void {
    if (this.showTrail === show) return;
    this.showTrail = show;
    // Recreate planets with new trail setting if they exist
    if (this.planetRed || this.planetBlue) {
      this.removePlanets();
      this.createPlanets();
    }
  }

  public setHitsoundEnabled(enabled: boolean): void {
    this.hitsoundManager.setEnabled(enabled);
  }

  public setUseWorker(use: boolean): void {
    this.useWorker = use;
    const workerManager = getWorkerManager();
    workerManager.setEnabled(use);
  }

  public setTargetFramerate(framerate: TargetFramerateType): void {
    this.targetFramerate = framerate;
    this.updateFrameInterval();
  }

  public setUseInstancing(use: boolean): void {
    if (this.useInstancing === use) return;
    this.useInstancing = use;
    console.log('[Player] GPU Instancing:', use ? 'enabled' : 'disabled');
    // If switching away from instancing, clear instanced meshes from scene
    if (!use && this.instancedRenderer) {
      this.instancedRenderer.clearScene();
      this.updateVisibleTiles();
    }
  }

  public setLockCamera(enabled: boolean): void {
    if (this.lockCamera === enabled) return;
    this.lockCamera = enabled;
    this.cameraController.setLockCamera(enabled);
    console.log('[Player] Lock Camera:', enabled ? 'enabled' : 'disabled');
    // Reset camera state when toggling to avoid stale transitions
    if (enabled) {
      this.cameraPosition.x = this.currentPivotPosition.x;
      this.cameraPosition.y = this.currentPivotPosition.y;
      this.camera.rotation.z = 0;
    }
  }

  private updateFrameInterval(): void {
    if (this.targetFramerate === 'auto') {
      // Use monitor refresh rate (no limiting)
      this.frameInterval = 0;
    } else if (this.targetFramerate === 'unlimited') {
      this.frameInterval = 0;
    } else {
      const fps = parseInt(this.targetFramerate, 10);
      this.frameInterval = 1000 / fps; // milliseconds per frame
    }
  }

  public createPlayer(container: HTMLElement): void {
    this.container = container;
    
    // Append current renderer element
    this.container.appendChild(this.renderer.domElement);
    
    this.onWindowResize();
    
    this.updateVisibleTiles(); // Initial render of tiles
    
    this.setupEventListeners();
    
    this.startRenderLoop();
  }
  
  private setupEventListeners(): void {
    if (!this.container) return;
    
    // Store bound handlers so we can remove them later
    this.boundHandlers = {
      resize: this.onWindowResize.bind(this) as EventListener,
      mousedown: this.onMouseDown.bind(this) as unknown as EventListener,
      mousemove: this.onMouseMove.bind(this) as unknown as EventListener,
      mouseup: this.onMouseUp.bind(this) as unknown as EventListener,
      mouseleave: this.onMouseUp.bind(this) as unknown as EventListener,
      wheel: this.onWheel.bind(this) as unknown as EventListener,
      touchstart: this.onTouchStart.bind(this) as unknown as EventListener,
      touchmove: this.onTouchMove.bind(this) as unknown as EventListener,
      touchend: this.onTouchEnd.bind(this) as unknown as EventListener,
      contextmenu: ((e: Event) => e.preventDefault()) as EventListener,
    };
    
    // Window resize
    window.addEventListener('resize', this.boundHandlers.resize as EventListener);

    // Mouse events
    this.container.addEventListener('mousedown', this.boundHandlers.mousedown as EventListener);
    this.container.addEventListener('mousemove', this.boundHandlers.mousemove as EventListener);
    this.container.addEventListener('mouseup', this.boundHandlers.mouseup as EventListener);
    this.container.addEventListener('mouseleave', this.boundHandlers.mouseleave as EventListener);
    this.container.addEventListener('wheel', this.boundHandlers.wheel as EventListener);
    
    // Touch events
    this.container.addEventListener('touchstart', this.boundHandlers.touchstart as EventListener, { passive: false });
    this.container.addEventListener('touchmove', this.boundHandlers.touchmove as EventListener, { passive: false });
    this.container.addEventListener('touchend', this.boundHandlers.touchend as EventListener);
    
    this.container.addEventListener('contextmenu', this.boundHandlers.contextmenu as EventListener);
  }
  
  private removeEventListeners(): void {
    if (!this.container) return;
    
    if (this.boundHandlers.resize) {
      window.removeEventListener('resize', this.boundHandlers.resize as EventListener);
    }
    
    if (this.boundHandlers.mousedown) {
      this.container.removeEventListener('mousedown', this.boundHandlers.mousedown as EventListener);
      this.container.removeEventListener('mousemove', this.boundHandlers.mousemove as EventListener);
      this.container.removeEventListener('mouseup', this.boundHandlers.mouseup as EventListener);
      this.container.removeEventListener('mouseleave', this.boundHandlers.mouseleave as EventListener);
      this.container.removeEventListener('wheel', this.boundHandlers.wheel as EventListener);
      
      this.container.removeEventListener('touchstart', this.boundHandlers.touchstart as EventListener);
      this.container.removeEventListener('touchmove', this.boundHandlers.touchmove as EventListener);
      this.container.removeEventListener('touchend', this.boundHandlers.touchend as EventListener);
      
      this.container.removeEventListener('contextmenu', this.boundHandlers.contextmenu as EventListener);
    }
    
    this.boundHandlers = {};
  }

  // --- Interaction Handlers ---

  private onMouseDown(event: MouseEvent): void {
    if (event.button === 0) { // Left click
      this.isDragging = true;
      this.previousMousePosition = { x: event.clientX, y: event.clientY };
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = event.clientX - this.previousMousePosition.x;
    const deltaY = event.clientY - this.previousMousePosition.y;
    
    // Calculate world units per pixel
    const zoom = this.camera.zoom || 1.0;
    const frustumHeight = (this.camera.top - this.camera.bottom) / zoom;
    const unitsPerPixel = frustumHeight / this.container!.clientHeight;

    this.cameraPosition.x -= deltaX * unitsPerPixel;
    this.cameraPosition.y += deltaY * unitsPerPixel;
    
    this.camera.position.x = this.cameraPosition.x;
    this.camera.position.y = this.cameraPosition.y;

    this.updateVisibleTiles();

    this.previousMousePosition = { x: event.clientX, y: event.clientY };
  }

  private onMouseUp(): void {
    this.isDragging = false;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    
    const zoomSpeed = 0.1;
    if (event.deltaY < 0) {
      this.zoomMultiplier *= (1 + zoomSpeed);
    } else {
      this.zoomMultiplier /= (1 + zoomSpeed);
    }
    
    // Clamp zoom multiplier
    this.zoomMultiplier = Math.max(0.1, Math.min(this.zoomMultiplier, 10));
    
    this.onWindowResize();
  }

  // Touch support (simplified)
  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length === 1) {
      this.isDragging = true;
      this.previousMousePosition = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    } else if (event.touches.length === 2) {
      this.isDragging = false;
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      this.initialPinchDistance = Math.sqrt(dx*dx + dy*dy);
      this.initialZoom = this.zoomMultiplier;
    }
  }

  private onTouchMove(event: TouchEvent): void {
    event.preventDefault();
    if (this.isDragging && event.touches.length === 1) {
      const touch = event.touches[0];
      const deltaX = touch.clientX - this.previousMousePosition.x;
      const deltaY = touch.clientY - this.previousMousePosition.y;
      
      const zoom = this.camera.zoom || 1.0;
      const frustumHeight = (this.camera.top - this.camera.bottom) / zoom;
      const unitsPerPixel = frustumHeight / this.container!.clientHeight;
      
      this.cameraPosition.x -= deltaX * unitsPerPixel;
      this.cameraPosition.y += deltaY * unitsPerPixel;
      
      this.camera.position.x = this.cameraPosition.x;
      this.camera.position.y = this.cameraPosition.y;
      
      this.updateVisibleTiles();
      
      this.previousMousePosition = { x: touch.clientX, y: touch.clientY };
    } else if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      if (this.initialPinchDistance > 0) {
        const scale = distance / this.initialPinchDistance;
        this.zoomMultiplier = this.initialZoom * scale;
        this.zoomMultiplier = Math.max(0.1, Math.min(this.zoomMultiplier, 10));
        this.onWindowResize();
      }
    }
  }

  private onTouchEnd(): void {
    this.isDragging = false;
    this.initialPinchDistance = 0;
  }

  public setStatsCallback(callback: (stats: { fps: number; time: number; tileIndex: number }) => void): void {
    this.onStatsUpdate = callback;
  }

  public setStatsPanel(enabled: boolean): void {
    try {
      if (enabled && !this.stats) {
        // Create stats.js panel
        this.stats = new Stats();
        this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
        this.stats.dom.style.position = 'absolute';
        this.stats.dom.style.top = '64px';
        this.stats.dom.style.left = '16px';
        if (this.container) {
          this.container.appendChild(this.stats.dom);
        }
      } else if (!enabled && this.stats) {
        // Remove stats.js panel
        if (this.stats.dom.parentNode) {
          this.stats.dom.parentNode.removeChild(this.stats.dom);
        }
        this.stats = null;
      }
    } catch (e) {
      console.warn('Failed to initialize stats.js:', e);
      this.stats = null;
    }
  }

  private startRenderLoop(): void {
    let lastTime = performance.now();
    let frameCount = 0;
    let fps = 0;
    let fpsTime = lastTime;

    const animate = (time: number) => {
      try {
        this.stats?.begin();
      } catch (e) {
        // ignore stats errors
      }
      
      this.animationId = requestAnimationFrame(animate);
      
      // Frame rate limiting
      if (this.frameInterval > 0) {
        const elapsed = time - this.lastFrameTime;
        if (elapsed < this.frameInterval) {
          try {
            this.stats?.end();
          } catch (e) {
            // ignore stats errors
          }
          return; // Skip this frame
        }
        this.lastFrameTime = time - (elapsed % this.frameInterval);
      }
      
      const delta = (time - lastTime) / 1000;
      lastTime = time;
      
      if (this.isPlaying && !this.isPaused) {
        this.updatePlayer(delta);
        this.syncVideo();
      }
      
      this.renderPlayer(delta);
      
      // FPS calculation
      frameCount++;
      if (time - fpsTime >= 500) {
        fps = Math.round((frameCount * 1000) / (time - fpsTime));
        frameCount = 0;
        fpsTime = time;
        
        if (this.onStatsUpdate) {
          this.onStatsUpdate({
            fps,
            time: this.elapsedTime,
            tileIndex: this.currentTileIndex
          });
        }
      }
      
      try {
        this.stats?.end();
      } catch (e) {
        // ignore stats errors
      }
    };
    
    this.animationId = requestAnimationFrame(animate);
  }

  public updatePlayer(delta: number): void {
    if (!this.planetRed || !this.planetBlue) return;

    // Calculate current time using AudioContext for synchronization
    const settings = this.levelData.settings;
    const initialBPM = settings.bpm || 100;
    const initialSecPerBeat = 60 / initialBPM;
    const countdownTicks = settings.countdownTicks || 4;
    const countdownDuration = countdownTicks * initialSecPerBeat;
    const offset = this.music.hasAudio ? (settings.offset || 0) : 0;
    const firstTileOffset = this.tileStartTimes.length > 0 ? this.tileStartTimes[0] * 1000 : 0;

    // Debug: Log current state occasionally
    if (this.elapsedTime >= 0 && Math.floor(this.elapsedTime) === 0) {
      console.log('[Player] updatePlayer - elapsedTime:', this.elapsedTime.toFixed(2), 'countdownDuration:', countdownDuration.toFixed(2), 'offset:', offset);
    }

    // When music is loaded and playing, use AudioContext time for perfect sync
    if (this.music.hasAudio && this.music.isPlaying) {
      try {
        const audioContext = getSharedAudioContext();
        if (audioContext && this.useAudioContextTime) {
          // Calculate elapsed time from AudioContext
          // audioContextStartOffset is the AudioContext time when game time was 0
          // elapsedTime = (currentAudioContextTime - startTime) * 1000
          const contextElapsed = (audioContext.currentTime - this.audioContextStartOffset) * 1000;
          this.elapsedTime = contextElapsed;
        } else {
          // Fallback to performance.now() if AudioContext not available
          this.elapsedTime = performance.now() - this.startTime;
        }
      } catch (e) {
        this.elapsedTime = performance.now() - this.startTime;
      }
    } else if (this.music.hasAudio && !this.music.isPlaying && !this.music.isPaused && this.elapsedTime > this.musicStartDelay * 1000) {
      // Music ended but game continues
      const now = performance.now();
      this.elapsedTime = now - this.startTime;
    } else {
      // No music or countdown phase - use performance.now()
      if (this.isPlaying && !this.isPaused) {
        const now = performance.now();
        this.elapsedTime = now - this.startTime;
        
        // Debug: Log elapsedTime occasionally
        if (Math.floor(this.elapsedTime) % 1000 === 0 && this.elapsedTime < 10000) {
          console.log('[Player] elapsedTime:', this.elapsedTime.toFixed(2), 'ms');
        }

        // Start music at elapsedTime = musicStartDelay (when game starts + music delay)
        if (this.music.hasAudio && !this.music.isPaused && this.elapsedTime >= this.musicStartDelay * 1000 && !this.music.isPlaying) {
          // Initialize AudioContext sync
          try {
            const audioContext = getSharedAudioContext();
            if (audioContext) {
              // Music should start at elapsedTime = musicStartDelay
              // AudioContext.currentTime should = audioContextStartOffset + musicStartDelay
              const scheduledPlayTime = this.audioContextStartOffset + this.musicStartDelay;
              const offsetInSeconds = offset / 1000;
              
              console.log('[Player] Scheduling music to play at AudioContext time:', scheduledPlayTime, 'with offset:', offsetInSeconds, 'musicStartDelay:', this.musicStartDelay);
              this.music.playScheduled?.(scheduledPlayTime, offsetInSeconds);
            } else {
              // Fallback to simple play if no AudioContext
              this.music.audio!.currentTime = offset / 1000;
              this.music.play();
            }
          } catch (e) {
            console.warn('[Player] Failed to schedule music:', e);
            this.music.play();
          }
        }
      }
    }
    
    this.updatePlanetsPosition();

    this.updateCameraFollow(delta);

    this.updateAnimatedTiles();

    // Update decorations
    this.updateDecorations();

    // Update MoveTrack animations
    this.updateMoveTrack();
  }
  
  private updateDecorations(): void {
    if (!this.decorationManager) return;

    this.decorationManager.update(
      this.elapsedTime,
      this.camera.position,
      this.camera.rotation.z,
      this.camera.zoom
    );
  }

  private updateMoveTrack(): void {
    if (!this.moveTrackManager) return;

    // Calculate timeInLevel matching CameraController's logic
    const countdownTicks = this.levelData.settings.countdownTicks || 0;
    const initialBPM = this.levelData.settings.bpm || 100;
    const initialSecPerBeat = 60 / initialBPM;
    const countdownDuration = countdownTicks * initialSecPerBeat;

    const currentTimeInSeconds = this.elapsedTime / 1000;
    const timeInLevel = currentTimeInSeconds - countdownDuration;

    // Pass timeInLevel in milliseconds
    this.moveTrackManager.update(timeInLevel * 1000);
  }

  private updateAnimatedTiles(): void {
    const time = this.elapsedTime / 1000;
    
    this.visibleTiles.forEach(id => {
        const index = parseInt(id);
        const config = this.tileColorManager.getTileRecolorConfig(index);
        
        if (config && ['Glow', 'Blink', 'Rainbow', 'Volume'].includes(config.trackColorType)) {
            const rendered = this.tileColorManager.getTileRenderer(index, time, config, this.music.amplitude);
            this.applyTileColor(index, rendered.color, rendered.bgcolor);
        }
    });
  }

  public renderPlayer(delta: number): void {
    // If renderer not initialized, try to initialize it
    if (!this.rendererInitialized && !this.isRestoringContext) {
      this.initRenderer();
      return;
    }

    // Skip rendering if context is being restored
    if (this.isRestoringContext) {
      return;
    }
    
    if (this.renderer && this.scene && this.camera) {
      try {
        const isWebGPU = this.rendererType === 'webgpu';
        const backendReady = !isWebGPU || (this.renderer as any).backend !== null;
        
        if (!backendReady) {
          return;
        }
        
        const gl = (this.renderer as any).getContext?.();
        if (gl && gl.isContextLost?.()) {
          return;
        }
        
        if (this.bloomEnabled && !isWebGPU && this.bloomEffect && this.bloomEffect.getEnabled()) {
          if (!this.renderTarget) {
            this.renderTarget = new THREE.WebGLRenderTarget(
              this.container?.clientWidth || window.innerWidth,
              this.container?.clientHeight || window.innerHeight
            );
          }
          
          this.renderer.setRenderTarget(this.renderTarget);
          this.renderer.render(this.scene, this.camera);
          this.renderer.setRenderTarget(null);
          
          this.bloomEffect.render(this.renderer as THREE.WebGLRenderer, this.renderTarget.texture);
        } else {
          if (this.renderMethod === 'async' || isWebGPU) {
            (this.renderer as any).renderAsync(this.scene, this.camera).catch((e: Error) => {
              console.warn('Render error:', e.message);
            });
          } else {
            this.renderer.render(this.scene, this.camera);
          }
        }
        
        // Render Flash effect (overlay on top of scene)
        if (this.flashEffect && this.flashEffect.isActive()) {
          this.flashEffect.renderFlash(this.renderer as THREE.WebGLRenderer, this.elapsedTime / 1000);
        }
      } catch (e) {
        console.warn('Render error:', e);
      }
    }
  }

  // AudioContext synchronization
  private audioContextStartOffset: number = 0;  // AudioContext.currentTime when game elapsedTime = 0
  private useAudioContextTime: boolean = false;

  public startPlay(): void {
    if (this.isPlaying) return;
    
    this.isPlaying = true;
    this.isPaused = false;
    this.startTime = performance.now(); // elapsedTime = 0 when startPlay is called
    this.elapsedTime = 0;
    this.currentTileIndex = 0;
    this.useAudioContextTime = false;
    
    this.createPlanets();
    
    // Reset camera state
    this.cameraController.setLastCameraTimelineIndex(-1);
    this.cameraController.resetCameraState();
    
    // Build Recolor timeline
    this.buildRecolorTimeline();
    this.lastRecolorTimelineIndex = -1;
    
    // Build Flash timeline
    this.buildFlashTimeline();
    this.lastFlashTimelineIndex = -1;
    
    // Reset decorations
    if (this.decorationManager) {
      this.decorationManager.reset();
    }
    
    // Calculate delay for countdown
    const settings = this.levelData.settings;
    const initialBPM = settings.bpm || 100;
    const initialSecPerBeat = 60 / initialBPM;
    const countdownTicks = settings.countdownTicks || 4;
    const countdownDuration = countdownTicks * initialSecPerBeat;
    const offset = this.music.hasAudio ? (settings.offset || 0) : 0;
    // tileStartTimes[1] = 0 (after shift)
    // tileStartTimes[0] is negative (before tile 1)
    // offset means: when game starts (elapsedTime = countdownDuration), music should play to offset position
    // So when elapsedTime = countdownDuration, music.currentTime = offset
    
    // Music and hitsounds start after countdown
    // Music plays from offset position, hitsounds start at tileStartTimes[i] (relative to tile 1)
    // Note: elapsedTime = 0 when startPlay is called (countdown starts), elapsedTime = countdownDuration when game starts
    
    // Calculate music delay based on tile[0].angle
    // Music needs to play (angle - 180) degrees early, which is (angle - 180) / 180 beats early
    // If musicDelaySeconds is positive, music plays early; if negative, music plays late
    const firstTileAngle = this.levelData.tiles[0]?.angle || 180;
    const musicDelayBeats = (firstTileAngle - 180) / 180;
    const musicDelaySeconds = musicDelayBeats * initialSecPerBeat;
    
    console.log('[Player] startPlay - firstTileAngle:', firstTileAngle, 'musicDelayBeats:', musicDelayBeats, 'musicDelaySeconds:', musicDelaySeconds);
    
    // musicStartDelay can be negative (play early) or positive (play late)
    const musicStartDelay = countdownDuration - musicDelaySeconds; // Music starts after countdown minus music delay
    const hitsoundStartDelay = countdownDuration; // Hitsounds start after countdown (no delay)

    // Store delays for use in updatePlayer
    this.musicStartDelay = musicStartDelay;
    this.hitsoundStartDelay = hitsoundStartDelay;

    // Debug: Print tileStartTimes
    console.log('[Player] startPlay - offset:', offset, 'countdownDuration:', countdownDuration);
    console.log('[Player] startPlay - tileStartTimes (first 10):', this.tileStartTimes.slice(0, 10));

    // Initialize AudioContext for synchronization
    try {
      const audioContext = getSharedAudioContext();
      if (audioContext) {
        // audioContextStartOffset is the AudioContext time when game time = 0
        this.audioContextStartOffset = audioContext.currentTime - this.elapsedTime / 1000;
      }
    } catch (e) {
      console.warn('[Player] Failed to initialize AudioContext:', e);
    }

    // Start pre-synthesized hitsound track
    const synthesized = this.hitsoundManager.isSynthesized();
    console.log('[Player] startPlay - hitsound synthesized:', synthesized, 'hitsoundStartDelay:', hitsoundStartDelay);
    if (synthesized) {
        this.hitsoundManager.start(hitsoundStartDelay);
    }
  }

  private buildBloomTimeline(): void {
      this.bloomTimeline = [];
      const entries: { time: number; event: any }[] = [];
      
      this.iterateTileEvents((floor, events) => {
          const startTime = this.tileStartTimes[floor] || 0;
          const bpm = this.tileBPM[floor] || 100;
          const secPerBeat = 60 / bpm;
          
          events.forEach(event => {
              if (event.eventType === 'Bloom') {
                  const angleOffset = event.angleOffset || 0;
                  const timeOffset = (angleOffset / 180) * secPerBeat;
                  const eventTime = startTime + timeOffset;
                  entries.push({ time: eventTime, event: { ...event, floor } });
              }
          });
      });
      
      entries.sort((a, b) => a.time - b.time);
      this.bloomTimeline = entries;
  }
  
  private processBloomEvent(event: any): void {
      const enabled = event.enabled;
      
      if (enabled === true || enabled === 'Enabled' || enabled === '') {
          this.bloomEnabled = true;
          if (event.threshold !== undefined) this.bloomThreshold = event.threshold;
          if (event.intensity !== undefined) this.bloomIntensity = event.intensity;
          if (event.color !== undefined) {
              if (Array.isArray(event.color)) {
                  const r = Math.round(event.color[0] * 255).toString(16).padStart(2, '0');
                  const g = Math.round(event.color[1] * 255).toString(16).padStart(2, '0');
                  const b = Math.round(event.color[2] * 255).toString(16).padStart(2, '0');
                  this.bloomColor = r + g + b;
              } else if (typeof event.color === 'string') {
                  this.bloomColor = event.color.replace('#', '');
              } else {
                  this.bloomColor = 'ffffff';
              }
          }
      } else if (enabled === false || enabled === 'Disabled') {
          this.bloomEnabled = false;
      }
      
      if (this.bloomEffect) {
          this.bloomEffect.setEnabled(this.bloomEnabled);
          this.bloomEffect.setThreshold(this.bloomThreshold / 100);
          this.bloomEffect.setIntensity(this.bloomIntensity / 100);
          this.bloomEffect.setColor(this.bloomColor);
      }
  }
  
  private buildCustomBGTimeline(): void {
      this.customBGTimeline = [];
      const entries: { time: number; event: any }[] = [];
      
      this.iterateTileEvents((floor, events) => {
          const startTime = this.tileStartTimes[floor] || 0;
          const bpm = this.tileBPM[floor] || 100;
          const secPerBeat = 60 / bpm;
          
          events.forEach(event => {
              if (event.eventType === 'SetCustomBG') {
                  const angleOffset = event.angleOffset || 0;
                  const timeOffset = (angleOffset / 180) * secPerBeat;
                  const eventTime = startTime + timeOffset;
                  entries.push({ time: eventTime, event: { ...event, floor } });
              }
          });
      });
      
      entries.sort((a, b) => a.time - b.time);
      this.customBGTimeline = entries;
  }
  
  private processCustomBGEvent(event: any): void {
      // SetCustomBG event properties:
      // - color: background color (hex string)
      // - image: image filename
      // - imageColor: tint color for image
      // - parallax: [x, y] parallax factor
      // - tiled: boolean
      // - looping: boolean
      // - fitScreen: boolean
      // - lockRot: boolean
      // - scalingRatio: number
      // - imageSmoothing: boolean
      
      // Update background color
      if (event.color !== undefined) {
          const bgColor = this.formatHexColor(event.color);
          this.scene.background = new THREE.Color(bgColor);
      }
      
      // Update custom background image
      const imagePath = event.image;
      
      if (!imagePath || imagePath === '') {
          // Remove custom background
          if (this.customBGMesh) {
              this.scene.remove(this.customBGMesh);
              if (this.customBGMesh.geometry) this.customBGMesh.geometry.dispose();
              if (this.customBGMesh.material instanceof THREE.Material) {
                  this.customBGMesh.material.dispose();
              }
              this.customBGMesh = null;
          }
          if (this.customBGTexture) {
              this.customBGTexture.dispose();
              this.customBGTexture = null;
          }
          return;
      }
      
      // Check if we have the image registered
      const imageUrl = this.customBGImages.get(imagePath);
      if (!imageUrl) {
          console.warn('[Player] CustomBG image not registered:', imagePath);
          return;
      }
      
      // Dispose old texture and mesh
      if (this.customBGTexture) {
          this.customBGTexture.dispose();
      }
      if (this.customBGMesh) {
          this.scene.remove(this.customBGMesh);
          if (this.customBGMesh.geometry) this.customBGMesh.geometry.dispose();
          if (this.customBGMesh.material instanceof THREE.Material) {
              this.customBGMesh.material.dispose();
          }
      }
      
      // Load new texture
      const loader = new THREE.TextureLoader();
      loader.load(imageUrl, (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          
          // Apply smoothing setting
          texture.minFilter = event.imageSmoothing === false ? THREE.NearestFilter : THREE.LinearFilter;
          texture.magFilter = event.imageSmoothing === false ? THREE.NearestFilter : THREE.LinearFilter;
          
          this.customBGTexture = texture;
          
          // Calculate mesh size based on fitScreen and scalingRatio
          const fitScreen = event.fitScreen !== false;
          const scalingRatio = event.scalingRatio || 100;
          const scale = scalingRatio / 100;
          
          // Get camera view size for fitScreen
          const viewHeight = this.camera.top - this.camera.bottom;
          const viewWidth = this.camera.right - this.camera.left;
          
          let meshWidth: number, meshHeight: number;
          
          if (fitScreen) {
              meshWidth = viewWidth * 2;
              meshHeight = viewHeight * 2;
          } else {
              // Use texture size with scaling
              const img = texture.image;
              meshWidth = (img?.width || 100) * scale / 100;
              meshHeight = (img?.height || 100) * scale / 100;
          }
          
          // Create mesh
          const geometry = new THREE.PlaneGeometry(meshWidth, meshHeight);
          
          // Apply image color tint
          const imageColor = event.imageColor ? this.formatHexColor(event.imageColor) : '#ffffff';
          const color = new THREE.Color(imageColor);
          
          const material = new THREE.MeshBasicMaterial({
              map: texture,
              color: color,
              transparent: true,
              depthWrite: false,
              depthTest: false
          });
          
          this.customBGMesh = new THREE.Mesh(geometry, material);
          this.customBGMesh.renderOrder = -1000; // Render before everything
          this.scene.add(this.customBGMesh);
          
          // Store parallax for update
          (this.customBGMesh as any).parallaxData = {
              parallax: event.parallax || [100, 100],
              lockRot: event.lockRot || false
          };
      });
  }
  
  private updateCustomBGParallax(): void {
      if (!this.customBGMesh) return;
      
      const data = (this.customBGMesh as any).parallaxData;
      if (!data) return;
      
      const parallax = data.parallax || [100, 100];
      const px = parallax[0] / 100;
      const py = parallax[1] / 100;
      
      // Apply inverse parallax (move opposite to camera)
      this.customBGMesh.position.x = -this.camera.position.x * (1 - px);
      this.customBGMesh.position.y = -this.camera.position.y * (1 - py);
      
      // Apply rotation lock
      if (data.lockRot) {
          this.customBGMesh.rotation.z = -this.camera.rotation.z;
      }
  }

  public stopPlay(): void {
    this.isPlaying = false;
    this.isPaused = false;
    this.removePlanets();
    
    if (this.music && (this.music as any).hasAudio ? this.music.hasAudio : false) {
      this.music.stop();
    }
    
    // Stop pre-synthesized hitsound track
    this.hitsoundManager.stop();
    
    if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.currentTime = 0;
    }
    
    this.bloomEnabled = false;
    this.bloomThreshold = 10;
    this.bloomIntensity = 150; 
    this.bloomColor = 'ffffff';
    this.lastBloomTimelineIndex = -1;
    this.lastCustomBGTimelineIndex = -1;
    if (this.bloomEffect) {
      this.bloomEffect.setEnabled(false);
      this.bloomEffect.setThreshold(0.5);
      this.bloomEffect.setIntensity(1);
      this.bloomEffect.setColor('ffffff');
    }
    
    // Reset Flash effect
    this.lastFlashTimelineIndex = -1;
    if (this.flashEffect) {
      this.flashEffect.stop();
      this.flashEffect.reset();
    }
    
        // Reset decorations
        if (this.decorationManager) {
          this.decorationManager.reset();
        }
    
        // Reset MoveTrack (restore tiles to initial positions)
        if (this.moveTrackManager) {
          this.moveTrackManager.reset();
        }
    
        // Re-apply PositionTrack transforms (PositionTrack is global and applies at all times)
        this.reapplyPositionTrackTransforms();

        this.tileColorManager.initTileColors();    this.lastRecolorTimelineIndex = -1;
    this.tiles.forEach((_, id) => {
        this.updateTileMeshColor(parseInt(id));
    });
  }

  public pausePlay(): void {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    this.pauseTime = performance.now();
    if (this.music && (this.music as any).hasAudio ? this.music.hasAudio : false) {
      this.music.pause();
    }
    // Stop pre-synthesized hitsound track
    this.hitsoundManager.stop();
  }

  public resumePlay(): void {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    const pauseDuration = performance.now() - this.pauseTime;
    this.startTime += pauseDuration;
    if (this.music && (this.music as any).hasAudio ? this.music.hasAudio : false) {
      this.music.resume();
    }
    
    const currentTimeInSeconds = this.elapsedTime / 1000;
    const settings = this.levelData.settings;
    const countdownTicks = settings.countdownTicks || 4;
    const countdownBPM = (this.tileBPM && this.tileBPM[0]) || settings.bpm || 100;
    const initialSecPerBeat = 60 / countdownBPM;
    const countdownDuration = countdownTicks * initialSecPerBeat;
    const timeInLevel = currentTimeInSeconds - countdownDuration;
    
    // Resume pre-synthesized hitsound track from current position
    if (this.hitsoundManager.isSynthesized() && timeInLevel > 0) {
        this.hitsoundManager.startAtOffset(timeInLevel);
    }
  }

  public resetPlayer(): void {
    this.stopPlay();
    this.startPlay();
  }

  public setEditorMode(isEditorMode: boolean): void {
    this.isEditorMode = isEditorMode;
    // Re-calculate all tile positions with new editor mode
    if (this.positionTrackManager) {
      const allTransforms = this.positionTrackManager.calculateAllTileTransforms(this.isEditorMode);
      this.tiles.forEach((mesh, id) => {
        const index = parseInt(id);
        const transform = allTransforms[index];
        if (transform) {
          mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
          mesh.rotation.z = transform.rotation * (Math.PI / 180);
          const s = transform.scale;
          mesh.scale.set(s, s, s);
          
          if ((mesh.material as any).transparent !== undefined) {
            const opacity = transform.opacity < 1 ? transform.opacity : 1;
            (mesh.material as any).opacity = opacity;
            (mesh.material as any).transparent = transform.opacity < 1;
          }
        }
      });
      
      // Update tileStickToFloors array
      for (let i = 0; i < this.levelData.tiles.length; i++) {
        const transform = allTransforms[i];
        this.tileStickToFloors[i] = transform?.stickToFloors ?? (this.levelData.settings?.stickToFloors !== false);
      }
    }
  }

  /**
   * Re-apply PositionTrack transforms to all tiles
   * PositionTrack is global and applies at all times (not just during playback)
   */
  private reapplyPositionTrackTransforms(): void {
    if (!this.positionTrackManager) return;
    
    // Calculate all transforms at once for efficiency and correctness
    const allTransforms = this.positionTrackManager.calculateAllTileTransforms(this.isEditorMode);
    
    this.tiles.forEach((mesh, id) => {
      const index = parseInt(id);
      const transform = allTransforms[index];
      
      if (transform) {
        mesh.position.set(transform.position.x, transform.position.y, transform.position.z);
        mesh.rotation.z = transform.rotation * (Math.PI / 180);
        const s = transform.scale;
        mesh.scale.set(s, s, s);
        
        if ((mesh.material as any).transparent !== undefined) {
          const opacity = transform.opacity < 1 ? transform.opacity : 1;
          (mesh.material as any).opacity = opacity;
          (mesh.material as any).transparent = transform.opacity < 1;
        }
      }
    });
    
    // Update tileStickToFloors array
    for (let i = 0; i < this.levelData.tiles.length; i++) {
      const transform = allTransforms[i];
      this.tileStickToFloors[i] = transform?.stickToFloors ?? (this.levelData.settings?.stickToFloors !== false);
    }
  }

  private buildRecolorTimeline(): void {
    this.recolorTimeline = [];
    const entries: { time: number; event: any }[] = [];
    
    this.iterateTileEvents((floor, events) => {
        const startTime = this.tileStartTimes[floor] || 0;
        const bpm = this.tileBPM[floor] || 100;
        const secPerBeat = 60 / bpm;
        
        events.forEach(event => {
            if (event.eventType === 'RecolorTrack') {
                const angleOffset = event.angleOffset || 0;
                const timeOffset = (angleOffset / 180) * secPerBeat;
                const eventTime = startTime + timeOffset;
                entries.push({ time: eventTime, event: { ...event, floor } });
            }
        });
    });
    
    entries.sort((a, b) => a.time - b.time);
    this.recolorTimeline = entries;
  }

  private processRecolorEvent(event: any): void {
    const startIdx = this.tileColorManager.PosRelativeTo(event.startTile, event.floor);
    const endIdx = this.tileColorManager.PosRelativeTo(event.endTile, event.floor);
    const gap = (event.gapLength !== undefined) ? event.gapLength : 0;
    
    const settings = this.levelData.settings;
    const defaultColor = settings.trackColor || 'debb7b';
    const defaultSecondaryColor = settings.secondaryTrackColor || 'ffffff';
    const defaultStyle = settings.trackStyle || 'Standard';
    const defaultColorType = settings.trackColorType || 'Single';

    const colors = this.tileColorManager.parseColorTrackType(
        event.trackStyle || defaultStyle, 
        event.trackColor || defaultColor, 
        event.secondaryTrackColor || defaultSecondaryColor
    );

    const config: TileColorConfig = {
        trackStyle: event.trackStyle || defaultStyle,
        trackColorType: event.trackColorType || defaultColorType,
        trackColor: colors.color,
        secondaryTrackColor: colors.bgcolor,
        trackColorPulse: event.trackColorPulse || settings.trackColorPulse || 'None',
        trackColorAnimDuration: event.trackColorAnimDuration || settings.trackColorAnimDuration || 2,
        trackPulseLength: event.trackPulseLength || settings.trackPulseLength || 10
    };

    const minIdx = Math.max(0, Math.min(startIdx, endIdx));
    const maxIdx = Math.min(this.tileColorManager.getTotalTiles() - 1, Math.max(startIdx, endIdx));
    
    for (let i = minIdx; i <= maxIdx; i += (gap + 1)) {
        this.tileColorManager.setTileRecolorConfig(i, config);
        const rendered = this.tileColorManager.getTileRenderer(i, this.elapsedTime / 1000, config, this.music.amplitude);
        this.applyTileColor(i, rendered.color, rendered.bgcolor);
    }
  }

  private applyTileColor(index: number, color: string, bgcolor: string): void {
    this.tileColorManager.setTileColor(index, color, bgcolor);
    this.updateTileMeshColor(index);
  }

  private updateTileMeshColor(index: number): void {
    const id = index.toString();
    const mesh = this.tiles.get(id);
    if (mesh && mesh.material instanceof THREE.ShaderMaterial) {
        const colors = this.tileColorManager.getTileColor(index);
        if (colors) {
            mesh.material.uniforms.uColor.value.set(colors.color);
            mesh.material.uniforms.uBgColor.value.set(colors.secondaryColor || colors.color);
        }
    }
  }

  private buildFlashTimeline(): void {
    this.flashTimeline = [];
    const entries: { time: number; event: any }[] = [];
    
    this.iterateTileEvents((floor, events) => {
        const startTime = this.tileStartTimes[floor] || 0;
        const bpm = this.tileBPM[floor] || 100;
        const secPerBeat = 60 / bpm;
        
        events.forEach(event => {
            if (event.eventType === 'Flash') {
                const angleOffset = event.angleOffset || 0;
                const timeOffset = (angleOffset / 180) * secPerBeat;
                const eventTime = startTime + timeOffset;
                entries.push({ time: eventTime, event: { ...event, floor } });
            }
        });
    });
    
    entries.sort((a, b) => a.time - b.time);
    this.flashTimeline = entries;
  }

  private processFlashEvent(event: any): void {
    if (!this.flashEffect) return;
    
    const bpm = this.tileBPM[event.floor] || 100;
    const secPerBeat = 60 / bpm;
    
    // Parse duration (in beats, convert to seconds)
    const duration = (event.duration !== undefined ? event.duration : 1) * secPerBeat;
    
    // Parse colors
    const startColor = event.startColor || 'ffffff';
    const endColor = event.endColor || 'ffffff';
    
    // Parse opacity (0-100, convert to 0-1)
    const startOpacity = (event.startOpacity !== undefined ? event.startOpacity : 100) / 100;
    const endOpacity = (event.endOpacity !== undefined ? event.endOpacity : 0) / 100;
    
    // Parse ease (default to Linear)
    const ease = event.ease || 'Linear';
    
    // Parse plane (0 = FG, 1 = BG)
    const plane = event.plane === 1 ? 'BG' : 'FG';
    
    // Start the flash effect
    this.flashEffect.startFlash(
        this.elapsedTime / 1000,  // Current time in seconds
        duration,
        startColor,
        endColor,
        startOpacity,
        endOpacity,
        ease,
        plane
    );
  }

  // --- Helper Methods ---

  public onWindowResize(): void {
    if (!this.container) return;
    
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    const aspect = width / height;
    const baseFrustumSize = 8;
    
    this.camera.left = -baseFrustumSize * aspect / 2;
    this.camera.right = baseFrustumSize * aspect / 2;
    this.camera.top = baseFrustumSize / 2;
    this.camera.bottom = -baseFrustumSize / 2;
    
    this.camera.zoom = this.zoom * this.zoomMultiplier;
    
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    
    if (this.renderTarget) {
      this.renderTarget.setSize(width, height);
    }
    if (this.bloomEffect) {
      this.bloomEffect.setSize(width, height);
      if (this.flashEffect) {
        this.flashEffect.setSize(width, height);
      }
    }
    
    this.updateVideoSize();
    this.updateVisibleTiles();
  }

  private updateVideoSize(): void {
    if (!this.videoElement || !this.videoMesh || !this.container) return;
    
    const videoWidth = this.videoElement.videoWidth || 16;
    const videoHeight = this.videoElement.videoHeight || 9;
    const videoAspect = videoWidth / videoHeight;
    
    const frustumHeight = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const frustumWidth = (this.camera.right - this.camera.left) / this.camera.zoom;
    const frustumAspect = frustumWidth / frustumHeight;
    
    let scale = 1;
    if (frustumAspect > videoAspect) {
        scale = frustumWidth / 1.0;
        this.videoMesh.scale.set(scale, scale / videoAspect, 1);
    } else {
        scale = frustumHeight / 1.0;
        this.videoMesh.scale.set(scale * videoAspect, scale, 1);
    }
  }

  private createPlanets(): void {
    this.planetRed = new Planet(0xff0000, undefined, this.showTrail);
    this.planetBlue = new Planet(0x0000ff, undefined, this.showTrail);
    
    this.planetRed.render(this.scene);
    this.planetBlue.render(this.scene);
    
    if (this.levelData.tiles && this.levelData.tiles.length > 1) {
      const t0 = this.levelData.tiles[0];
      const t1 = this.levelData.tiles[1];
      if (t0 && t1) {
        this.planetRed.position.set(t0.position[0], t0.position[1], 0.1);
        this.planetBlue.position.set(t1.position[0], t1.position[1], 0.1);
      }
    }
  }

  private removePlanets(): void {
    if (this.planetRed) {
      this.planetRed.removeFromScene(this.scene);
      this.planetRed.dispose();
      this.planetRed = null;
    }
    if (this.planetBlue) {
      this.planetBlue.removeFromScene(this.scene);
      this.planetBlue.dispose();
      this.planetBlue = null;
    }
  }

  private getContainerSize(): { width: number; height: number } {
    if (!this.container) return { width: window.innerWidth, height: window.innerHeight };
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
  }

  /**
   * Initialize shared decoration geometries and materials
   */
  private initSharedDecorationResources(): void {
    const decoSize = 0.275 * 0.8;
    
    this.sharedDecoGeometry = new THREE.CircleGeometry(decoSize / 2, 16);
    
    this.sharedTwirlMaterial = new THREE.MeshBasicMaterial({ color: 0x800080 });
    this.sharedSpeedUpMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    this.sharedSpeedDownMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
  }

  private lastVisibleCheckPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lastVisibleCheckZoom = -1;

  private updateVisibleTiles(): void {
    if (!this.scene || !this.levelData.tiles || !this.camera) return;

    const zoom = this.camera.zoom || 1.0;
    
    const distSq = this.cameraPosition.distanceToSquared(this.lastVisibleCheckPos);
    if (distSq < 0.01 && Math.abs(zoom - this.lastVisibleCheckZoom) < 0.01) {
        return;
    }
    
    this.lastVisibleCheckPos.copy(this.cameraPosition);
    this.lastVisibleCheckZoom = zoom;

    const left = this.cameraPosition.x + this.camera.left / zoom;
    const right = this.cameraPosition.x + this.camera.right / zoom;
    const bottom = this.cameraPosition.y + this.camera.bottom / zoom;
    const top = this.cameraPosition.y + this.camera.top / zoom;
    
    const margin = 2.0;
    const newVisibleTiles: number[] = [];

    const minCellX = Math.floor((left - margin) / this.spatialGridSize);
    const maxCellX = Math.floor((right + margin) / this.spatialGridSize);
    const minCellY = Math.floor((bottom - margin) / this.spatialGridSize);
    const maxCellY = Math.floor((top + margin) / this.spatialGridSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const tileIndices = this.spatialGrid.get(cx * 100000 + cy);
        if (tileIndices) {
          for (let i = 0; i < tileIndices.length; i++) {
            newVisibleTiles.push(tileIndices[i]);
          }
        }
      }
    }

    // GPU Instanced path — single draw call per geometry type
    if (this.useInstancing && this.instancedRenderer) {
      this.updateInstancedTiles(newVisibleTiles);
      return;
    }

    // Legacy per-mesh path
    const idsInScene = Array.from(this.visibleTiles);
    for (let i = 0; i < idsInScene.length; i++) {
        const id = idsInScene[i];
        const idx = parseInt(id);
        if (!newVisibleTiles.includes(idx)) {
            const mesh = this.tiles.get(id);
            if (mesh) {
                this.scene.remove(mesh);
            }
            this.visibleTiles.delete(id);
        }
    }

    for (let i = 0; i < newVisibleTiles.length; i++) {
      const idx = newVisibleTiles[i];
      const id = idx.toString();
      if (!this.visibleTiles.has(id)) {
        const tileMesh = this.getOrCreateTileMesh(idx);
        if (tileMesh) {
          this.scene.add(tileMesh);
          this.visibleTiles.add(id);
        }
      }
    }

    if (this.tiles.size > this.maxCachedTiles) {
        this.cleanupTileCache();
    }
  }

  private cleanupTileCache(): void {
    const tileEntries = Array.from(this.tiles.entries());
    
    tileEntries.sort((a, b) => {
        const distA = a[1].position.distanceToSquared(this.cameraPosition);
        const distB = b[1].position.distanceToSquared(this.cameraPosition);
        return distB - distA;
    });
    
    const toRemoveCount = Math.floor(this.tiles.size * 0.3);
    let removed = 0;
    
    for (let i = 0; i < tileEntries.length && removed < toRemoveCount; i++) {
        const [id, mesh] = tileEntries[i];
        if (!this.visibleTiles.has(id)) {
            if (mesh.material instanceof THREE.Material) {
                mesh.material.dispose();
            }
            this.tiles.delete(id);
            removed++;
        }
    }
  }

  /**
   * Get tile geometry shapeKey (same logic as getOrCreateTileMesh but without mesh creation)
   */
  private getTileShapeKey(index: number): string {
    const tile = this.levelData.tiles[index];
    if (!tile) return '0_0_false_Standard';

    const tileConfig = this.tileColorManager.getTileRecolorConfig(index);
    const trackStyle = tileConfig?.trackStyle || 'Standard';

    let pred = -180;
    if (index > 0) {
      const prevTile = this.levelData.tiles[index - 1];
      pred = (prevTile.direction || 0) - 180;
      if (prevTile.direction === 999 && index > 1) {
        pred = (this.levelData.tiles[index - 2].direction || 0);
      }
    }

    const currentDirection = tile.direction || 0;
    const is999 = (tile.angle === 0);
    return `${pred}_${currentDirection}_${is999}_${trackStyle}`;
  }

  /**
   * Ensure geometry exists in cache, create if needed
   */
  private ensureTileGeometry(shapeKey: string): THREE.BufferGeometry | null {
    let geometry = this.geometryCache.get(shapeKey);
    if (geometry) return geometry;

    const parts = shapeKey.split('_');
    const pred = parseFloat(parts[0]);
    const direction = parseFloat(parts[1]);
    const is999 = parts[2] === 'true';
    const trackStyle = parts[3] || 'Standard';

    const meshData = createTrackMesh(pred, direction, is999, undefined, undefined, undefined, trackStyle);
    if (!meshData || !meshData.faces) return null;

    geometry = new THREE.BufferGeometry();
    geometry.setIndex(meshData.faces);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.colors, 3));
    geometry.computeVertexNormals();
    this.geometryCache.set(shapeKey, geometry);
    return geometry;
  }

  /**
   * GPU instanced tile update — replaces individual mesh creation/destruction
   */
  private updateInstancedTiles(visibleIndices: number[]): void {
    if (!this.instancedRenderer) return;

    const tiles = this.levelData.tiles;
    const tileData: TileInstanceData[] = new Array(visibleIndices.length);
    let writeIdx = 0;

    for (let v = 0; v < visibleIndices.length; v++) {
      const idx = visibleIndices[v];
      const tile = tiles[idx];
      if (!tile) continue;

      // Ensure geometry is cached
      const shapeKey = this.getTileShapeKey(idx);
      if (!this.ensureTileGeometry(shapeKey)) continue;

      // Get position/transform
      let x = tile.position[0], y = tile.position[1];
      let z = (12 - idx) * 0.001;
      let rotation = 0;
      let scale = 1;

      if (this.positionTrackManager) {
        const transform = this.positionTrackManager.getTileTransform(idx);
        if (transform) {
          x = transform.position.x;
          y = transform.position.y;
          z = transform.position.z;
          rotation = transform.rotation * (Math.PI / 180);
          scale = transform.scale;
        }
      }

      // Get colors
      const colors = this.tileColorManager.getTileColor(idx);
      const color = colors?.color || '#debb7b';
      const bgColor = colors?.secondaryColor || color;

      tileData[writeIdx++] = { shapeKey, x, y, z, rotation, scale, color, bgColor };
    }

    // Trim array if some tiles were skipped
    if (writeIdx < tileData.length) {
      (tileData as any).length = writeIdx;
    }

    this.instancedRenderer.update(tileData, this.geometryCache);
  }

  private getOrCreateTileMesh(index: number): THREE.Mesh | null {
    const id = index.toString();
    if (this.tiles.has(id)) return this.tiles.get(id)!;

    const tile = this.levelData.tiles[index];
    if (!tile) return null;
    
    const [x, y] = tile.position;
    const zLevel = 12 - index;
    
    let pred = -180;
    if (index > 0) {
       const prevTile = this.levelData.tiles[index - 1];
       pred = (prevTile.direction || 0) - 180;
       if (prevTile.direction === 999 && index > 1) {
         pred = (this.levelData.tiles[index - 2].direction || 0);
       }
    }
    
    const currentDirection = tile.direction || 0;
    const is999 = (tile.angle === 0);
    
    // Get track style from tile color config
    const tileConfig = this.tileColorManager.getTileRecolorConfig(index);
    const trackStyle = tileConfig?.trackStyle || 'Standard';

    const shapeKey = `${pred}_${currentDirection}_${is999}_${trackStyle}`;
    let geometry = this.geometryCache.get(shapeKey);

    if (!geometry) {
      const meshData = createTrackMesh(pred, currentDirection, is999, undefined, undefined, undefined, trackStyle);
      if (!meshData || !meshData.faces) return null;

      geometry = new THREE.BufferGeometry();
      geometry.setIndex(meshData.faces);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(meshData.colors, 3));
      geometry.computeVertexNormals();
      this.geometryCache.set(shapeKey, geometry);
    }

    const colors = this.tileColorManager.getTileColor(index);
    const color = colors?.color || '#ffffff';
    const bgcolor = colors?.secondaryColor || color;
    
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uBgColor: { value: new THREE.Color(bgcolor) }
        },
        vertexShader: `
            varying vec3 vColor;
            void main() {
                vColor = color;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uBgColor;
            varying vec3 vColor;
            void main() {
                vec3 finalColor = mix(uBgColor, uColor, vColor.r);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: false
    });

    const tileMesh = new THREE.Mesh(geometry, material);

    // Calculate transform from PositionTrack
    if (this.positionTrackManager) {
      const transform = this.positionTrackManager.getTileTransform(index);
      if (transform) {
        tileMesh.position.set(transform.position.x, transform.position.y, transform.position.z);
        tileMesh.rotation.z = transform.rotation * (Math.PI / 180); // Convert degrees to radians
        const s = transform.scale;
        tileMesh.scale.set(s, s, s);
        
        // Apply opacity if supported by material
        if (transform.opacity < 1 && (material as any).transparent !== undefined) {
          (material as any).transparent = true;
          (material as any).opacity = transform.opacity;
        }
      }
    } else {
      // Fallback to original position calculation
      tileMesh.position.set(x, y, zLevel * 0.001);
    }

    tileMesh.castShadow = true;
    tileMesh.receiveShadow = true;
    
    // Add decorations
    const decoZ = 0.002;
    let hasTwirl = false;
    let hasSetSpeed = false;
    
    if (this.tileEvents.size > 0 && this.tileEvents.has(index)) {
        const events = this.tileEvents.get(index)!;
        events.forEach(e => {
            if (e.eventType === 'Twirl') hasTwirl = true;
            if (e.eventType === 'SetSpeed') hasSetSpeed = true;
        });
    } else {
        // Large file fallback: check tiles[i].actions
        const tile = this.levelData.tiles[index];
        if (tile?.actions) {
            for (const e of tile.actions) {
                if (e.eventType === 'Twirl') hasTwirl = true;
                if (e.eventType === 'SetSpeed') hasSetSpeed = true;
            }
        }
    }
    
    if (hasTwirl && this.sharedDecoGeometry && this.sharedTwirlMaterial) {
        const twirlMesh = new THREE.Mesh(this.sharedDecoGeometry, this.sharedTwirlMaterial);
        twirlMesh.position.set(0, 0, decoZ);
        tileMesh.add(twirlMesh);
    }
    
    if (hasSetSpeed && this.sharedDecoGeometry) {
        const currentBPM = this.tileBPM[index];
        const prevBPM = index > 0 ? this.tileBPM[index - 1] : (this.levelData.settings.bpm || 100);
        const ratio = currentBPM / prevBPM;
        
        if (ratio > 1.05 && this.sharedSpeedUpMaterial) {
            const speedMesh = new THREE.Mesh(this.sharedDecoGeometry, this.sharedSpeedUpMaterial);
            speedMesh.position.set(0, 0, decoZ + (hasTwirl ? 0.001 : 0));
            tileMesh.add(speedMesh);
        } else if (ratio < 0.95 && this.sharedSpeedDownMaterial) {
            const speedMesh = new THREE.Mesh(this.sharedDecoGeometry, this.sharedSpeedDownMaterial);
            speedMesh.position.set(0, 0, decoZ + (hasTwirl ? 0.001 : 0));
            tileMesh.add(speedMesh);
        }
    }
    
    this.tiles.set(id, tileMesh);

    // Register tile initial state with MoveTrack manager
    if (this.moveTrackManager) {
      this.moveTrackManager.registerTileInitial(index, tileMesh);
    }

    return tileMesh;
  }

  private updatePlanetsPosition(): void {
    if (!this.planetRed || !this.planetBlue) return;
    
    const currentTimeInSeconds = this.elapsedTime / 1000;
    const settings = this.levelData.settings;
    const countdownTicks = settings.countdownTicks || 4;
    
    const offset = this.music.hasAudio ? (this.levelData.settings.offset || 0) : 0;
    
    const countdownBPM = (this.tileBPM && this.tileBPM[0]) || settings.bpm || 100;
    const initialSecPerBeat = 60 / countdownBPM;
    const countdownDuration = countdownTicks * initialSecPerBeat;
    const timeInLevel = (this.elapsedTime / 1000) - countdownDuration;
    
    // Process Recolor timeline
    if (this.lastRecolorTimelineIndex >= 0) {
        const currentEntry = this.recolorTimeline[this.lastRecolorTimelineIndex];
        if (currentEntry && timeInLevel < currentEntry.time) {
            this.tileColorManager.initTileColors();
            this.lastRecolorTimelineIndex = -1;
            this.tiles.forEach((_, id) => {
                this.updateTileMeshColor(parseInt(id));
            });
        }
    }

    while (this.lastRecolorTimelineIndex + 1 < this.recolorTimeline.length && 
           this.recolorTimeline[this.lastRecolorTimelineIndex + 1].time <= timeInLevel) {
        this.lastRecolorTimelineIndex++;
        const entry = this.recolorTimeline[this.lastRecolorTimelineIndex];
        this.processRecolorEvent(entry.event);
    }

    if (timeInLevel < 0) {
        // Countdown phase - handled by standard logic
    }
    
    // Playing Phase
    if (this.tileStartTimes.length > 0) {
        if (timeInLevel < this.tileStartTimes[this.currentTileIndex]) {
            let low = 0, high = this.tileStartTimes.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (this.tileStartTimes[mid] <= timeInLevel) {
                    this.currentTileIndex = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
        } else {
            while (this.currentTileIndex + 1 < this.tileStartTimes.length && 
                   this.tileStartTimes[this.currentTileIndex + 1] <= timeInLevel) {
                this.currentTileIndex++;
            }
        }
    }
    
    const tileIndex = this.currentTileIndex;
    
    // Check if we are past the last tile (Infinite Rotation)
    if (tileIndex >= this.levelData.tiles.length - 1) {
        const lastIndex = this.levelData.tiles.length - 1;
        const lastTile = this.levelData.tiles[lastIndex];
        
        if (lastTile) {
             const isRedPivot = (lastIndex % 2 === 0);
             const pivotPlanet = isRedPivot ? this.planetRed : this.planetBlue;
             const movingPlanet = isRedPivot ? this.planetBlue : this.planetRed;
             
             const pivotPos = lastTile.position;
             this.currentPivotPosition.x = pivotPos[0];
             this.currentPivotPosition.y = pivotPos[1];
             pivotPlanet.position.set(pivotPos[0], pivotPos[1], 0);
             
             let startAngle = 0;
             if (lastIndex > 0) {
                 const prevTile = this.levelData.tiles[lastIndex - 1];
                 const pdx = prevTile.position[0] - pivotPos[0];
                 const pdy = prevTile.position[1] - pivotPos[1];
                 startAngle = Math.atan2(pdy, pdx);
             }
             
             const extraTime = timeInLevel - this.tileStartTimes[lastIndex];
             const bpm = this.tileBPM[lastIndex] || 100;
             const radiansPerSecond = (bpm / 60) * Math.PI;
             const isCW = this.tileIsCW[lastIndex];
             
             const totalAngle = extraTime * radiansPerSecond;
             
             const currentAngle = isCW ? (startAngle - totalAngle) : (startAngle + totalAngle);
             
             const dist = 1.0;
             movingPlanet.position.set(
                 pivotPos[0] + Math.cos(currentAngle) * dist,
                 pivotPos[1] + Math.sin(currentAngle) * dist,
                 0.1
             );
             
             pivotPlanet.position.z = 0.1;
             pivotPlanet.update(0, currentTimeInSeconds);
             movingPlanet.update(0, currentTimeInSeconds);
        }
        return;
    }

    // Normal Rotation Logic
    const pivot = this.levelData.tiles[tileIndex];

    if (pivot) {
        const isRedPivot = (tileIndex % 2 === 0);
        const pivotPlanet = isRedPivot ? this.planetRed : this.planetBlue;
        const movingPlanet = isRedPivot ? this.planetBlue : this.planetRed;

        // Get tile position based on stickToFloors
        // If stickToFloors is false, use original position (planet doesn't follow tile movement)
        // If stickToFloors is true, use actual mesh position (planet follows tile movement)
        const tileId = tileIndex.toString();
        const tileMesh = this.tiles.get(tileId);
        const tileData = this.levelData.tiles[tileIndex];
        const useStickToFloor = this.tileStickToFloors[tileIndex] !== false;
        
        let pivotPos: THREE.Vector3;
        if (useStickToFloor && tileMesh) {
            // Use actual tile mesh position (may have been moved by PositionTrack/MoveTrack)
            pivotPos = tileMesh.position.clone();
        } else {
            // Use original tile position (planet doesn't follow tile movement)
            pivotPos = new THREE.Vector3(tileData.position[0], tileData.position[1], tileMesh ? tileMesh.position.z : 0);
        }

        this.currentPivotPosition.x = pivotPos.x;
        this.currentPivotPosition.y = pivotPos.y;

        // Pivot planet uses the selected position
        pivotPlanet.position.set(pivotPos.x, pivotPos.y, 0.1);

        const startTime = this.tileStartTimes[tileIndex];
        const duration = this.tileDurations[tileIndex];
        const progress = duration > 0.0001 ? (timeInLevel - startTime) / duration : 1;

        const startAngle = this.tileStartAngle[tileIndex];
        const totalAngle = this.tileTotalAngle[tileIndex];
        const currentAngle = startAngle + totalAngle * progress;

        const clampedProgress = Math.max(0, Math.min(1, progress));
        const startDist = this.tileStartDist[tileIndex];
        const endDist = this.tileEndDist[tileIndex];
        const currentDist = startDist + (endDist - startDist) * clampedProgress;

        // Calculate planet position relative to selected pivot position
        const planetX = pivotPos.x + Math.cos(currentAngle) * currentDist;
        const planetY = pivotPos.y + Math.sin(currentAngle) * currentDist;

        movingPlanet.position.set(planetX, planetY, 0.1);
    }
    
    this.planetRed.update(0, currentTimeInSeconds);
    this.planetBlue.update(0, currentTimeInSeconds);
  }
  
  private updateCameraFollow(delta: number): void {
      if (!this.planetRed || !this.planetBlue) return;

      const settings = this.levelData.settings;
      const initialBPM = settings.bpm || 100;
      const initialSecPerBeat = 60 / initialBPM;
      const countdownTicks = settings.countdownTicks || 4;
      const countdownDuration = countdownTicks * initialSecPerBeat;
      
      const currentTimeInSeconds = this.elapsedTime / 1000;
      const timeInLevel = currentTimeInSeconds - countdownDuration;

      // Process camera events
      const lastIdx = this.cameraController.getLastCameraTimelineIndex();
      const cameraTimeline = this.cameraController.getCameraTimeline();
      
      if (lastIdx >= 0) {
          const currentEntry = cameraTimeline[lastIdx];
          if (currentEntry && timeInLevel < currentEntry.time) {
              this.cameraController.resetCameraState();
              this.cameraController.setLastCameraTimelineIndex(-1);
          }
      }

      let newIdx = lastIdx;
      while (newIdx + 1 < cameraTimeline.length && 
             cameraTimeline[newIdx + 1].time <= timeInLevel) {
          newIdx++;
          const entry = cameraTimeline[newIdx];
          // Pass current camera state and tile index for proper transition handling
          const cameraSnapshot = {
              position: { x: this.cameraPosition.x, y: this.cameraPosition.y },
              zoom: this.zoom * 100,  // Convert back to ADOFAI format
              rotation: this.camera.rotation.z * (180 / Math.PI)
          };
          this.cameraController.processCameraEvent(
              entry.event, 
              entry.event.floor || 0, 
              this.elapsedTime,
              cameraSnapshot
          );
      }
      this.cameraController.setLastCameraTimelineIndex(newIdx);
      
      // Process Bloom events
      if (this.lastBloomTimelineIndex >= 0) {
          const currentEntry = this.bloomTimeline[this.lastBloomTimelineIndex];
          if (currentEntry && timeInLevel < currentEntry.time) {
              this.bloomEnabled = false;
              this.lastBloomTimelineIndex = -1;
          }
      }
      
      while (this.lastBloomTimelineIndex + 1 < this.bloomTimeline.length && 
             this.bloomTimeline[this.lastBloomTimelineIndex + 1].time <= timeInLevel) {
          this.lastBloomTimelineIndex++;
          const entry = this.bloomTimeline[this.lastBloomTimelineIndex];
          this.processBloomEvent(entry.event);
      }
      
      // Process CustomBG events
      while (this.lastCustomBGTimelineIndex + 1 < this.customBGTimeline.length && 
             this.customBGTimeline[this.lastCustomBGTimelineIndex + 1].time <= timeInLevel) {
          this.lastCustomBGTimelineIndex++;
          const entry = this.customBGTimeline[this.lastCustomBGTimelineIndex];
          this.processCustomBGEvent(entry.event);
      }
      
      // Update custom background parallax
      this.updateCustomBGParallax();
      
      // Process Flash events
      while (this.lastFlashTimelineIndex + 1 < this.flashTimeline.length && 
             this.flashTimeline[this.lastFlashTimelineIndex + 1].time <= timeInLevel) {
          this.lastFlashTimelineIndex++;
          const entry = this.flashTimeline[this.lastFlashTimelineIndex];
          this.processFlashEvent(entry.event);
      }
      
      // Get interpolated camera values
      const interpolated = this.cameraController.getInterpolatedValues(this.elapsedTime);
      
      // Lock Camera mode: snap camera to current tile center each frame (no smoothing, no rotation)
      if (this.lockCamera) {
        this.cameraPosition.x = this.currentPivotPosition.x;
        this.cameraPosition.y = this.currentPivotPosition.y;

        // Update camera position
        this.camera.position.x = this.cameraPosition.x;
        this.camera.position.y = this.cameraPosition.y;
        
        // Zoom: still apply from interpolated values (zoom events still work)
        this.zoom = 100 / interpolated.zoom;
        this.camera.zoom = this.zoom * this.zoomMultiplier;
        this.camera.updateProjectionMatrix();
        
        // No rotation when camera is locked
        this.camera.rotation.z = 0;

        // Sync Video Background
        if (this.videoMesh) {
            this.videoMesh.position.x = this.camera.position.x;
            this.videoMesh.position.y = this.camera.position.y;
            this.videoMesh.rotation.z = this.camera.rotation.z;
            
            if (Math.abs(this.camera.zoom - this.lastVisibleCheckZoom) > 0.001) {
                this.updateVideoSize();
            }
        }

        this.updateVisibleTiles();
        return;
      }
      
      // Calculate target position based on camera mode
      const target = this.cameraController.calculateTargetPosition(this.currentPivotPosition);

      // Apply smoothing — skip smoothing at extreme BPM (camera would lag thousands of tiles behind)
      const currentBPM = (this.tileBPM && this.tileBPM[this.currentTileIndex]) || 100;
      const smoothingIndex = 15 * Math.pow(100 / Math.max(1, currentBPM), 0.15);
      
      if (smoothingIndex < 1) {
        // Extreme BPM — instant camera follow, no smoothing
        this.cameraPosition.x = target.x;
        this.cameraPosition.y = target.y;
      } else {
        const step = 1.0 - Math.pow(1.0 - 1.0 / smoothingIndex, delta * 60);
        this.cameraPosition.x += (target.x - this.cameraPosition.x) * step;
        this.cameraPosition.y += (target.y - this.cameraPosition.y) * step;
      }

      // Update camera position
      this.camera.position.x = this.cameraPosition.x;
      this.camera.position.y = this.cameraPosition.y;
      
      // Zoom: ADOFAI zoom 100 = normal view, 200 = 2x zoomed out
      // THREE.js OrthographicCamera: zoom = 1 is normal, zoom > 1 is zoomed in
      // So: THREE.zoom = 100 / ADOFAI.zoom
      this.zoom = 100 / interpolated.zoom;
      this.camera.zoom = this.zoom * this.zoomMultiplier;
      this.camera.updateProjectionMatrix();
      
      // Rotation (in degrees, convert to radians)
      this.camera.rotation.z = interpolated.rotation * (Math.PI / 180);

      // Sync Video Background
      if (this.videoMesh) {
          this.videoMesh.position.x = this.camera.position.x;
          this.videoMesh.position.y = this.camera.position.y;
          this.videoMesh.rotation.z = this.camera.rotation.z;
          
          if (Math.abs(this.camera.zoom - this.lastVisibleCheckZoom) > 0.001) {
              this.updateVideoSize();
          }
      }

      this.updateVisibleTiles();
  }

  public setZoom(logicalZoom: number): void {
    const cameraMode = this.cameraController.getCameraMode();
    cameraMode.zoom = logicalZoom;
    this.zoom = 100 / logicalZoom;
    this.onWindowResize();
  }

  public loadMusic(src: string): void {
    this.music.load(src);
    
    if (this.levelData.settings) {
        if (this.levelData.settings.volume !== undefined) {
            this.music.volume = this.levelData.settings.volume / 100;
        }
        if (this.levelData.settings.pitch !== undefined) {
            this.music.pitch = this.levelData.settings.pitch / 100;
        }
    }
  }

  public loadVideo(src: string): void {
    // Cleanup old video if exists
    if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.src = "";
        this.videoElement.load();
        this.videoElement.remove();
        this.videoElement = null;
    }
    if (this.videoTexture) {
        this.videoTexture.dispose();
        this.videoTexture = null;
    }
    if (this.videoMesh) {
        this.scene.remove(this.videoMesh);
        if (this.videoMesh.geometry) this.videoMesh.geometry.dispose();
        if (this.videoMesh.material instanceof THREE.Material) {
            this.videoMesh.material.dispose();
        }
        this.videoMesh = null;
    }

    const video = document.createElement('video');
    video.src = src;
    video.crossOrigin = 'anonymous';
    video.loop = this.levelData.settings?.loopVideo || false;
    video.muted = true;
    video.playsInline = true;
    
    this.videoElement = video;
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.PlaneGeometry(1, 1); 
    const material = new THREE.MeshBasicMaterial({ 
        map: this.videoTexture,
        depthWrite: false,
        depthTest: true,
        transparent: false
    });
    this.videoMesh = new THREE.Mesh(geometry, material);
    this.videoMesh.position.set(0, 0, -500);
    this.videoMesh.renderOrder = -999;
    this.scene.add(this.videoMesh); 

    video.onloadedmetadata = () => {
        this.updateVideoSize();
    };

    video.load();
    console.log("Video loaded, offset:", this.videoOffset);
  }

  /**
   * Register a custom decoration image
   * @param filename The filename to reference this image
   * @param url The URL or base64 data URL of the image
   */
  public registerDecorationImage(filename: string, url: string): void {
    if (this.decorationManager) {
      this.decorationManager.registerCustomImage(filename, url);
    }
  }
  
  /**
   * Register a custom background image for SetCustomBG events
   * @param filename The filename of the image (as referenced in level data)
   * @param url The URL or base64 data URL of the image
   */
  public registerCustomBGImage(filename: string, url: string): void {
    this.customBGImages.set(filename, url);
  }
  
  /**
   * Preload all decoration textures asynchronously
   * Call this after registering all decoration images and before startPlay
   * @returns Promise resolving to number of textures loaded
   */
  public async preloadDecorationTextures(): Promise<number> {
    if (this.decorationManager) {
      return this.decorationManager.preloadTextures();
    }
    return 0;
  }

  private syncVideo(): void {
    if (!this.videoElement || !this.isPlaying || this.isPaused) return;

    const settings = this.levelData.settings;
    const initialBPM = settings.bpm || 100;
    const initialSecPerBeat = 60 / initialBPM;
    const countdownTicks = settings.countdownTicks || 4;
    const countdownDuration = countdownTicks * initialSecPerBeat;
    
    const timeInLevel = (this.elapsedTime / 1000) - countdownDuration;
    
    const targetVideoTime = timeInLevel + (this.videoOffset / 1000);

    if (targetVideoTime < 0) {
        if (!this.videoElement.paused) {
            this.videoElement.pause();
            this.videoElement.currentTime = 0;
        }
    } else {
        if (this.videoElement.paused) {
            this.videoElement.play().catch(e => console.warn("Video play failed:", e));
        }
        
        if (Math.abs(this.videoElement.currentTime - targetVideoTime) > 0.1) {
            this.videoElement.currentTime = targetVideoTime;
        }
    }
  }

  /**
   * Calculate basic tile positions without PositionTrack
   * This is needed because we skipped ADOFAI-JS's calculateTilePosition()
   */
  private calculateBasicTilePositions(): void {
    const tiles = this.levelData.tiles;
    const angleData = this.levelData.angleData || [];
    
    // Start from (0, 0)
    let currentPos = new THREE.Vector2(0, 0);
    
    // Pre-calculate all angles
    const floats = new Array(tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      floats[i] = angleData[i] === 999 ? (angleData[i - 1] || 0) + 180 : angleData[i];
    }
    
    // Calculate positions
    for (let i = 0; i < tiles.length; i++) {
      const angle = floats[i];
      
      // Save current position for this tile
      tiles[i].position = [currentPos.x, currentPos.y];
      
      // Calculate next position based on angle
      const rad = angle * Math.PI / 180;
      currentPos.x += Math.cos(rad);
      currentPos.y += Math.sin(rad);
    }
  }

  public destroyPlayer(): void {
    this.stopPlay();
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.removeEventListeners();
    
    // Cleanup video
    if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.src = "";
        this.videoElement.load();
        this.videoElement.remove();
        this.videoElement = null;
    }
    if (this.videoTexture) {
        this.videoTexture.dispose();
        this.videoTexture = null;
    }
    if (this.videoMesh) {
        this.scene.remove(this.videoMesh);
        if (this.videoMesh.geometry) this.videoMesh.geometry.dispose();
        if (this.videoMesh.material instanceof THREE.Material) {
            this.videoMesh.material.dispose();
        }
        this.videoMesh = null;
    }

    // Cleanup MoveTrack manager first to reset tiles
    if (this.moveTrackManager) {
      this.moveTrackManager.dispose();
      this.moveTrackManager = null;
    }

    // Cleanup GPU instanced renderer
    if (this.instancedRenderer) {
      this.instancedRenderer.dispose();
      this.instancedRenderer = null;
    }

    // Cleanup Three.js resources
    this.tiles.forEach(mesh => {
        if (mesh.material instanceof THREE.Material) {
            mesh.material.dispose();
        }
        mesh.children.length = 0;
    });
    this.tiles.clear();
    this.visibleTiles.clear();
    
    // Dispose geometry cache
    this.geometryCache.forEach(geometry => {
        geometry.dispose();
    });
    this.geometryCache.clear();
    
    if (this.planetRed) this.planetRed.dispose();
    if (this.planetBlue) this.planetBlue.dispose();
    
    if (this.sharedDecoGeometry) {
      this.sharedDecoGeometry.dispose();
      this.sharedDecoGeometry = null;
    }
    if (this.sharedTwirlMaterial) {
      this.sharedTwirlMaterial.dispose();
      this.sharedTwirlMaterial = null;
    }
    if (this.sharedSpeedUpMaterial) {
      this.sharedSpeedUpMaterial.dispose();
      this.sharedSpeedUpMaterial = null;
    }
    if (this.sharedSpeedDownMaterial) {
      this.sharedSpeedDownMaterial.dispose();
      this.sharedSpeedDownMaterial = null;
    }

    this.spatialGrid.clear();

    // Cleanup decoration manager
    if (this.decorationManager) {
      this.decorationManager.dispose();
      this.decorationManager = null;
    }

    if (this.hitsoundManager) {
      this.hitsoundManager.dispose();
    }
    
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    if (this.bloomEffect) {
      this.bloomEffect.dispose();
          if (this.flashEffect) {
            this.flashEffect.dispose();
            this.flashEffect = null;
          }
      this.bloomEffect = null;
    }
    
    if (this.renderer) {
      if (this.container && this.renderer.domElement && this.renderer.domElement.parentNode === this.container) {
          this.container.removeChild(this.renderer.domElement);
      }
      this.renderer.dispose();
      this.renderer = null as any;
    }
    
    if (this.music) {
      this.music.dispose();
    }
  }
}