/**
 * PositionTrack event interface
 */
export interface PositionTrackEvent {
    positionOffset?: [number, number];
    relativeTo?: [number, string];
    rotation?: number;
    scale?: number;
    opacity?: number;
    justThisTile?: boolean;
    editorOnly?: boolean;
    stickToFloors?: boolean | 'Enabled' | 'Disabled';
}

/**
 * Tile transform result - uses plain objects instead of THREE.Vector3 for memory efficiency
 */
export interface TileTransform {
    position: { x: number; y: number; z: number };
    rotation: number;
    scale: number;
    opacity: number;
    stickToFloors: boolean;
}

/**
 * Manages PositionTrack events - using ADOFAI-Src's cumulative logic
 * Implements our own tile position calculation based on ADOFAI-JS structure
 * 
 * Memory optimization: Uses plain objects instead of THREE.Vector3/Vector2,
 * and Array instead of Map to minimize per-tile overhead.
 */
export class PositionTrackManager {
    private levelData: any;
    private positionTrackEvents: Map<number, PositionTrackEvent[]>;
    private tileTransforms: TileTransform[];
    private tilePositions: { [key: number]: { x: number; y: number } } = {};
    private _cachedIsEditorMode: boolean = false;
    private _cached: boolean = false;

    constructor(levelData: any) {
        this.levelData = levelData;
        this.positionTrackEvents = new Map();
        this.tileTransforms = [];

        this.parsePositionTrackEvents();
    }

    /**
     * Convert relativeTo to absolute tile ID (matches ADOFAI IDFromTile logic)
     * @param relativeTo The relativeTo value: [offset, relativeToType]
     * @param thisTileId The current tile ID (floor where event occurs)
     * @returns Absolute tile ID
     */
    private IDFromTile(relativeTo: [number, string], thisTileId: number): number {
        const offset = relativeTo[0];
        const relativeToType = relativeTo[1];
        const totalTiles = this.levelData.tiles.length;

        let result: number;

        switch (relativeToType) {
            case 'ThisTile':
            case '0':
                result = thisTileId + offset;
                break;
            case 'Start':
            case '1':
                result = offset;
                break;
            case 'End':
            case '2':
                result = totalTiles - 1 + offset;
                break;
            default:
                result = thisTileId + offset;
                break;
        }

        return Math.max(0, Math.min(result, totalTiles - 1));
    }

    /**
     * Parse stickToFloors value
     */
    private parseStickToFloors(value: boolean | 'Enabled' | 'Disabled' | undefined): boolean {
        if (value === undefined || value === null) {
            return this.levelData.settings?.stickToFloors !== false;
        }
        
        if (typeof value === 'boolean') {
            return value;
        }
        
        if (typeof value === 'string') {
            return value === 'Enabled';
        }
        
        return true;
    }

    /**
     * Parse position track events from level data
     */
    private parsePositionTrackEvents(): void {
        if (!this.levelData.actions) return;

        for (const action of this.levelData.actions) {
            if (action.eventType === 'PositionTrack') {
                const floor = action.floor;
                if (!this.positionTrackEvents.has(floor)) {
                    this.positionTrackEvents.set(floor, []);
                }
                this.positionTrackEvents.get(floor)!.push({
                    positionOffset: action.positionOffset || [0, 0],
                    relativeTo: action.relativeTo || [0, 'ThisTile'],
                    rotation: action.rotation || 0,
                    scale: action.scale || 100,
                    opacity: action.opacity || 100,
                    justThisTile: action.justThisTile || false,
                    editorOnly: action.editorOnly || false,
                    stickToFloors: this.parseStickToFloors(action.stickToFloors)
                });
            }
        }
    }

    /**
     * Calculate all tile positions and transforms
     * Uses ADOFAI-JS structure for position calculation
     * Uses ADOFAI-Src cumulative logic for PositionTrack
     * 
     * Memory optimization: Uses Array instead of Map, plain objects instead of THREE.Vector3
     */
    public calculateAllTileTransforms(isEditorMode: boolean = false): TileTransform[] {
        // Return cached result if available and editor mode hasn't changed
        if (this._cached && this._cachedIsEditorMode === isEditorMode) {
            return this.tileTransforms;
        }
        this._cachedIsEditorMode = isEditorMode;
        const tiles = this.levelData.tiles;
        const angleData = this.levelData.angleData || [];
        const n = tiles.length;
        const TILE_SIZE = 1.0;
        
        // Pre-allocate array
        // Reset tile positions for relative calculations
        this.tilePositions = {};
        const transforms: TileTransform[] = new Array(n);
        
        // Start from (0, 0) - plain objects instead of THREE.Vector2
        let currentPosX = 0;
        let currentPosY = 0;
        
        // Cumulative values (vector in ADOFAI-Src) - plain numbers
        let cumOffsetX = 0;
        let cumOffsetY = 0;
        let cumulativeRotation = 0;
        let cumulativeScale = 1;
        let cumulativeOpacity = 1;
        let cumulativeStickToFloors = this.levelData.settings?.stickToFloors !== false;

        // Pre-calculate all angles
        const floats = new Array(n);
        for (let i = 0; i < n; i++) {
            floats[i] = angleData[i] === 999 ? (angleData[i - 1] || 0) + 180 : angleData[i];
        }

        for (let i = 0; i <= n; i++) {
            const isLastTile = i === n;
            const angle1 = isLastTile ? (floats[i - 1] || 0) : floats[i];

            if (!isLastTile) {
                // Capture base tile position before processing events
                const tileBasePosX = currentPosX;
                const tileBasePosY = currentPosY;

                // Current tile transform - plain numbers
                let tileOffsetX = cumOffsetX;
                let tileOffsetY = cumOffsetY;
                let tileRotation = cumulativeRotation;
                let tileScale = cumulativeScale;
                let tileOpacity = cumulativeOpacity;
                let tileStickToFloors = cumulativeStickToFloors;

                // Process PositionTrack events for this tile
                const events = this.positionTrackEvents.get(i);
                if (events && events.length > 0) {
                    for (const event of events) {
                        if (event.editorOnly && !isEditorMode) {
                            continue;
                        }

                        // Apply position offset
                        if (event.positionOffset) {
                            let offsetX = event.positionOffset[0] || 0;
                            let offsetY = event.positionOffset[1] || 0;

                            // Handle relativeTo
                            if (event.relativeTo) {
                                const targetTileId = this.IDFromTile(event.relativeTo, i);
                                if (targetTileId !== i) {
                                    const targetBasePos = this.tilePositions[targetTileId];
                                    if (targetBasePos) {
                                        const targetTransform = transforms[targetTileId];
                                        const targetOffsetX = targetTransform ?
                                            targetTransform.position.x - targetBasePos.x : 0;
                                        const targetOffsetY = targetTransform ?
                                            targetTransform.position.y - targetBasePos.y : 0;

                                        // relativeOffset = targetBasePos + targetOffset - currentBasePos - currentOffset
                                        const relativeOffsetX = targetBasePos.x + targetOffsetX - tileBasePosX - tileOffsetX;
                                        const relativeOffsetY = targetBasePos.y + targetOffsetY - tileBasePosY - tileOffsetY;

                                        tileOffsetX += relativeOffsetX;
                                        tileOffsetY += relativeOffsetY;
                                    }
                                }
                            }

                            // Multiply by TILE_SIZE (matches ADOFAI)
                            tileOffsetX += offsetX * TILE_SIZE;
                            tileOffsetY += offsetY * TILE_SIZE;
                        }

                        // Apply rotation
                        if (event.rotation !== undefined) {
                            tileRotation = event.rotation;
                        }

                        // Apply scale
                        if (event.scale !== undefined) {
                            tileScale = event.scale / 100;
                        }

                        // Apply opacity
                        if (event.opacity !== undefined) {
                            tileOpacity = event.opacity / 100;
                        }

                        // Apply stickToFloors
                        if (event.stickToFloors !== undefined) {
                            tileStickToFloors = this.parseStickToFloors(event.stickToFloors);
                        }

                        // Update cumulative values for next tiles (if not justThisTile)
                        if (!event.justThisTile) {
                            cumOffsetX = tileOffsetX;
                            cumOffsetY = tileOffsetY;
                            cumulativeRotation = tileRotation;
                            cumulativeScale = tileScale;
                            cumulativeOpacity = tileOpacity;
                            cumulativeStickToFloors = tileStickToFloors;
                        }
                    }
                }

                // Calculate final position
                const finalX = currentPosX + tileOffsetX;
                const finalY = currentPosY + tileOffsetY;
                const zLevel = 12 - i;

                transforms[i] = {
                    position: { x: finalX, y: finalY, z: zLevel * 0.001 },
                    rotation: tileRotation,
                    scale: tileScale,
                    opacity: tileOpacity,
                    stickToFloors: tileStickToFloors
                };

                // Store base tile position for relative calculations
                this.tilePositions[i] = { x: tileBasePosX, y: tileBasePosY };
            }

            // Update position for next tile (based on angle)
            const rad = angle1 * Math.PI / 180;
            currentPosX += Math.cos(rad);
            currentPosY += Math.sin(rad);
        }

        this.tileTransforms = transforms;
        this._cached = true;
        return transforms;
    }

    /**
     * Get transform for a specific tile
     */
    public getTileTransform(tileIndex: number): TileTransform | undefined {
        return this.tileTransforms[tileIndex];
    }

    /**
     * Get all tile transforms
     */
    public getAllTileTransforms(): TileTransform[] {
        return this.tileTransforms;
    }

    /**
     * Dispose
     */
    public dispose(): void {
        this.positionTrackEvents.clear();
        this.tileTransforms = [];
        this.tilePositions = {};
        this._cached = false;
    }
}
