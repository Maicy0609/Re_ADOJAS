import * as THREE from 'three';

/**
 * Check if an event is active (should be processed)
 * active: undefined | true | "" | "Enabled" -> active (process event)
 * active: false | "Disabled" -> inactive (skip event)
 */
export const isEventActive = (event: any): boolean => {
    if (event.active === undefined) return true;
    if (event.active === true) return true;
    if (event.active === "") return true;
    if (event.active === "Enabled") return true;
    if (event.active === false) return false;
    if (event.active === "Disabled") return false;
    // Default to active for unknown values
    return true;
};

/**
 * Tile color configuration
 */
export interface TileColorConfig {
    trackStyle: string;
    trackColorType: string;
    trackColor: string;
    secondaryTrackColor: string;
    trackColorPulse: string;
    trackColorAnimDuration: number;
    trackPulseLength: number;
}

/**
 * Manager for tile colors and color events
 */
export class TileColorManager {
    private tileColors: { color: string, secondaryColor: string }[] = [];
    private tileRecolorConfigs: (TileColorConfig | null)[] = [];
    private levelData: any;
    private _useDefaultColors: boolean = false;
    
    // Default color constants
    private static _defaultColor = '#debb7b';
    private static _defaultSecondaryColor = '#ffffff';
    private static _defaultConfig: TileColorConfig = {
        trackStyle: 'Standard',
        trackColorType: 'Single',
        trackColor: '#debb7b',
        secondaryTrackColor: '#ffffff',
        trackColorPulse: 'None',
        trackColorAnimDuration: 2,
        trackPulseLength: 10,
    };
    
    // Reusable Color objects to avoid GC pressure in animation loop
    private static _reusableColor = new THREE.Color();
    private static _reusableColor2 = new THREE.Color();
    private static _reusableLighter = new THREE.Color();
    private static _reusableDarker = new THREE.Color();
    
    constructor(levelData: any) {
        this.levelData = levelData;
    }
    
    /**
     * Set default color mode - skip per-tile color allocation
     * Use this for very large levels to save memory
     */
    public setUseDefaultColors(use: boolean): void {
        this._useDefaultColors = use;
    }

    /**
     * Initialize tile colors from level settings
     */
    public initTileColors(): void {
        const totalTiles = this.levelData.tiles.length;
        const settings = this.levelData.settings;
        
        // For very large levels, skip per-tile allocation entirely
        if (this._useDefaultColors || totalTiles > 500000) {
            this._useDefaultColors = true;
            TileColorManager._defaultConfig = {
                trackStyle: settings.trackStyle || 'Standard',
                trackColorType: settings.trackColorType || 'Single',
                trackColor: settings.trackColor || 'debb7b',
                secondaryTrackColor: settings.secondaryTrackColor || 'ffffff',
                trackColorPulse: settings.trackColorPulse || 'None',
                trackColorAnimDuration: settings.trackColorAnimDuration || 2,
                trackPulseLength: settings.trackPulseLength || 10,
            };
            // Compute proper rendered colors (border = darker variant for Standard style)
            const rendered = this.getTileRenderer(0, 0, TileColorManager._defaultConfig);
            TileColorManager._defaultColor = rendered.color;
            TileColorManager._defaultSecondaryColor = rendered.bgcolor;
            return;
        }
        
        // Global defaults
        const defaultColor = settings.trackColor || 'debb7b';
        const defaultSecondaryColor = settings.secondaryTrackColor || 'ffffff';
        const defaultStyle = settings.trackStyle || 'Standard';
        const defaultColorType = settings.trackColorType || 'Single';

        // Initialize tileColors and configs
        this.tileColors = new Array(totalTiles);
        this.tileRecolorConfigs = new Array(totalTiles).fill(null);

        const globalConfig: TileColorConfig = {
            trackStyle: defaultStyle,
            trackColorType: defaultColorType,
            trackColor: defaultColor,  // Use original colors
            secondaryTrackColor: defaultSecondaryColor,  // Use original colors
            trackColorPulse: settings.trackColorPulse || 'None',
            trackColorAnimDuration: settings.trackColorAnimDuration || 2,
            trackPulseLength: settings.trackPulseLength || 10
        };

        // Optimization: Sort non-justThisTile events to process in one pass (O(N + E log E))
        const colorTrackEvents: any[] = [];
        if (this.levelData.actions) {
            this.levelData.actions.forEach((event: any) => {
                if (event.eventType === 'ColorTrack' && !event.justThisTile) {
                    colorTrackEvents.push(event);
                }
            });
        }
        colorTrackEvents.sort((a, b) => a.floor - b.floor);

        let currentEventIdx = 0;
        let currentConfig = globalConfig;

        for (let i = 0; i < totalTiles; i++) {
            // Update currentConfig if we reached a new ColorTrack floor
            while (currentEventIdx < colorTrackEvents.length && colorTrackEvents[currentEventIdx].floor <= i) {
                const event = colorTrackEvents[currentEventIdx];
                const eventTrackStyle = event.trackStyle || defaultStyle;

                currentConfig = {
                    trackStyle: eventTrackStyle,
                    trackColorType: event.trackColorType || defaultColorType,
                    trackColor: event.trackColor || defaultColor,  // Use original colors
                    secondaryTrackColor: event.secondaryTrackColor || defaultSecondaryColor,  // Use original colors
                    trackColorPulse: event.trackColorPulse || settings.trackColorPulse || 'None',
                    trackColorAnimDuration: event.trackColorAnimDuration || settings.trackColorAnimDuration || 2,
                    trackPulseLength: event.trackPulseLength || settings.trackPulseLength || 10
                };
                currentEventIdx++;
            }

            this.tileRecolorConfigs[i] = currentConfig;
            const rendered = this.getTileRenderer(i, 0, currentConfig);
            this.tileColors[i] = { color: rendered.color, secondaryColor: rendered.bgcolor };
        }

        // Handle justThisTile events (Static Preview Logic) separately as O(1)
        if (this.levelData.actions) {
            this.levelData.actions.forEach((event: any) => {
                if (event.eventType === 'ColorTrack' && event.justThisTile) {
                    const floor = event.floor;
                    if (floor >= 0 && floor < totalTiles) {
                        const config: TileColorConfig = {
                            trackStyle: event.trackStyle || defaultStyle,
                            trackColorType: event.trackColorType || defaultColorType,
                            trackColor: event.trackColor || defaultColor,  // Use original colors
                            secondaryTrackColor: event.secondaryTrackColor || defaultSecondaryColor,  // Use original colors
                            trackColorPulse: event.trackColorPulse || settings.trackColorPulse || 'None',
                            trackColorAnimDuration: event.trackColorAnimDuration || settings.trackColorAnimDuration || 2,
                            trackPulseLength: event.trackPulseLength || settings.trackPulseLength || 10
                        };

                        this.tileRecolorConfigs[floor] = config;
                        const rendered = this.getTileRenderer(floor, 0, config);
                        this.tileColors[floor] = { color: rendered.color, secondaryColor: rendered.bgcolor };
                    }
                }
            });
        }
    }
    
    public getTileColors(): { color: string, secondaryColor: string }[] {
        return this.tileColors;
    }
    
    public getTileRecolorConfigs(): (TileColorConfig | null)[] {
        return this.tileRecolorConfigs;
    }
    
    public getTileColor(index: number): { color: string, secondaryColor: string } | undefined {
        if (this._useDefaultColors) {
            return { color: TileColorManager._defaultColor, secondaryColor: TileColorManager._defaultSecondaryColor };
        }
        return this.tileColors[index];
    }
    
    public getTileRecolorConfig(index: number): TileColorConfig | null {
        if (this._useDefaultColors) {
            return TileColorManager._defaultConfig;
        }
        return this.tileRecolorConfigs[index];
    }
    
    public setTileColor(index: number, color: string, bgcolor: string): void {
        if (index >= 0 && index < this.tileColors.length) {
            this.tileColors[index] = { color, secondaryColor: bgcolor };
        }
    }
    
    public setTileRecolorConfig(index: number, config: TileColorConfig): void {
        if (index >= 0 && index < this.tileRecolorConfigs.length) {
            this.tileRecolorConfigs[index] = config;
        }
    }
    
    public getTotalTiles(): number {
        return this.tileColors.length;
    }

    /**
     * Process position relative keywords
     */
    /**
     * Parse tile reference to absolute tile index
     * ADOFAI format: [offset, relativeTo] where relativeTo is:
     *   - "ThisTile" or 0: relative to current tile (event floor)
     *   - "Start" or 1: relative to start of level
     *   - "End" or 2: relative to end of level
     * 
     * @param input The tile reference (can be array [offset, relativeTo] or single number)
     * @param thisid The current tile ID (floor where event occurs)
     * @returns Absolute tile index
     */
    public PosRelativeTo(input: any, thisid: number): number {
        const totalTiles = this.levelData.tiles.length;

        // Handle array format [offset, relativeTo]
        if (Array.isArray(input) && input.length >= 2) {
            const offset = Number(input[0]) || 0;
            const relativeTo = input[1];
            
            let result: number;
            
            // Parse relativeTo (can be string or number)
            if (relativeTo === "ThisTile" || relativeTo === 0) {
                // Relative to current tile
                result = thisid + offset;
            } else if (relativeTo === "Start" || relativeTo === 1) {
                // Relative to start (absolute position)
                result = offset;
            } else if (relativeTo === "End" || relativeTo === 2) {
                // Relative to end (from last tile)
                result = totalTiles - 1 + offset;
            } else {
                // Default: treat as ThisTile
                result = thisid + offset;
            }
            
            // Clamp to valid range
            return Math.max(0, Math.min(result, totalTiles - 1));
        }
        
        // Handle legacy string format with keywords
        if (typeof input === 'string') {
            const replaced = input
                .replace(/Start/g, "0")
                .replace(/ThisTile/g, String(thisid))
                .replace(/End/g, String(totalTiles - 1));
            return Math.max(0, Math.min(Number(replaced), totalTiles - 1));
        }
        
        // Handle single number
        return Math.max(0, Math.min(Number(input) || 0, totalTiles - 1));
    }

    public parseColorTrackType(Type: string, inputColor: string, inputBgColor: string): { color: string, bgcolor: string } {
        // Ensure colors include '#' prefix and handle alpha channels
        const trackColorX = this.formatHexColor(inputColor);
        const trackbgColorX = this.formatHexColor(inputBgColor);

        let intValue = { color: trackColorX, bgcolor: trackbgColorX };

        // Process colors based on track style (matches ADOFAI original logic)
        if (Type === "Standard" || Type === "Gems" || Type === "Basic" || Type === "Minimal") {
            // Standard/Gems: Darker version of main color for border
            intValue.bgcolor = this.processHexColor(trackColorX)[1];
            intValue.color = trackColorX;
        } else if (Type === "Neon") {
            // Neon: Black fill, colored border (glow effect)
            intValue.color = "#000000";
            intValue.bgcolor = trackColorX;
        } else if (Type === "NeonLight") {
            // NeonLight: Lighter border, colored fill
            intValue.color = this.processHexColor(trackColorX)[0];
            intValue.bgcolor = trackColorX;
        }

        return intValue;
    }

    /**
     * Core tile color renderer based on trackColorType
     */
    public getTileRenderer(id: number, time: number, rct: TileColorConfig, amplitude?: number): { color: string, bgcolor: string } {
        const {
            trackColorType, trackColor, secondaryTrackColor,
            trackColorPulse, trackColorAnimDuration, trackPulseLength,
            trackStyle
        } = rct;

        let renderer_tileClientColor = { color: trackColor, bgcolor: secondaryTrackColor };
        let shouldDraw = 0;

        const isNeon = trackStyle === "Neon";
        const isNeonLight = trackStyle === "NeonLight";

        // Calculate pulse offset based on tile ID (matches ADOFAI logic)
        let pulseOffset = 0;
        if (trackColorPulse === "Forward") {
            pulseOffset = (1 - (id % trackPulseLength) / trackPulseLength) * trackColorAnimDuration;
        } else if (trackColorPulse === "Backward") {
            pulseOffset = ((id % trackPulseLength) / trackPulseLength) * trackColorAnimDuration;
        }

        const effectiveTime = time + pulseOffset;

        // A. Single - Solid color
        if (trackColorType === "Single") {
            // Ensure colors are properly formatted (strip alpha if present)
            const formattedColor = this.formatHexColor(trackColor);
            renderer_tileClientColor.color = formattedColor;
            
            if (!isNeon && !isNeonLight) {
                // Standard style: darker border
                renderer_tileClientColor.bgcolor = this.processHexColor(formattedColor)[1];
            } else if (isNeonLight) {
                // NeonLight: lighter border
                renderer_tileClientColor.bgcolor = this.processHexColor(formattedColor)[0];
            }
            // Neon: already has correct colors from parseColorTrackType
            shouldDraw = 1;
        }

        // B. Stripes - Alternating colors
        else if (trackColorType === "Stripes") {
            const useColor1 = (id % 2 === 0);
            const primaryColor = useColor1 ? trackColor : secondaryTrackColor;

            if (isNeon) {
                renderer_tileClientColor.color = "#000000";
                renderer_tileClientColor.bgcolor = primaryColor;
            } else if (isNeonLight) {
                renderer_tileClientColor.color = this.processHexColor(primaryColor)[0];
                renderer_tileClientColor.bgcolor = primaryColor;
            } else {
                renderer_tileClientColor.color = primaryColor;
                renderer_tileClientColor.bgcolor = this.processHexColor(primaryColor)[1];
            }
            shouldDraw = 1;
        }

        // C. Glow - Pulsing glow effect (matches ADOFAI ColorFloor logic)
        else if (trackColorType === "Glow") {
            const t = 0.5 * Math.sin(Math.PI * 2 * effectiveTime / trackColorAnimDuration) + 0.5;

            // Glow uses white base with color overlay
            const glowColor = this.genColor("#ffffff", secondaryTrackColor, t);

            if (isNeon) {
                // Neon: black fill, glowing border
                renderer_tileClientColor.color = "#000000";
                renderer_tileClientColor.bgcolor = glowColor;
            } else if (isNeonLight) {
                // NeonLight: lighter fill, glowing border
                renderer_tileClientColor.color = glowColor;
                renderer_tileClientColor.bgcolor = glowColor;
            } else {
                // Standard: colored fill with glow
                renderer_tileClientColor.color = glowColor;
                renderer_tileClientColor.bgcolor = this.processHexColor(trackColor)[1];
            }
            shouldDraw = 1;
        }

        // D. Blink - On/off blinking
        else if (trackColorType === "Blink") {
            const t = (effectiveTime / trackColorAnimDuration) % 1;
            // Sharp transition at 0.5
            const isOn = t < 0.5;

            if (isNeon) {
                renderer_tileClientColor.color = "#000000";
                renderer_tileClientColor.bgcolor = isOn ? secondaryTrackColor : trackColor;
            } else {
                renderer_tileClientColor.color = isOn ? secondaryTrackColor : trackColor;
                renderer_tileClientColor.bgcolor = this.processHexColor(renderer_tileClientColor.color)[1];
            }
            shouldDraw = 1;
        }

        // E. Switch - Switch between two colors
        else if (trackColorType === "Switch") {
            const t = (effectiveTime / trackColorAnimDuration) % 1;
            // Smooth transition
            const switchColor = this.genColor(trackColor, secondaryTrackColor, t);

            if (isNeon) {
                renderer_tileClientColor.color = "#000000";
                renderer_tileClientColor.bgcolor = switchColor;
            } else {
                renderer_tileClientColor.color = switchColor;
                renderer_tileClientColor.bgcolor = this.processHexColor(switchColor)[1];
            }
            shouldDraw = 1;
        }

        // F. Rainbow - HSV rainbow animation
        else if (trackColorType === "Rainbow") {
            const hue = (effectiveTime / trackColorAnimDuration) % 1;
            const rainbowHex = '#' + TileColorManager._reusableColor.setHSL(hue, 0.8, 0.6).getHexString();

            if (isNeon) {
                renderer_tileClientColor.color = "#000000";
                renderer_tileClientColor.bgcolor = rainbowHex;
            } else if (isNeonLight) {
                renderer_tileClientColor.color = this.processHexColor(rainbowHex)[0];
                renderer_tileClientColor.bgcolor = rainbowHex;
            } else {
                renderer_tileClientColor.color = rainbowHex;
                renderer_tileClientColor.bgcolor = this.processHexColor(rainbowHex)[1];
            }
            shouldDraw = 1;
        }

        // G. Volume - Audio amplitude based
        else if (trackColorType === "Volume") {
            const amp = amplitude || 0;
            // Volume modulates lightness
            const baseColor = isNeon ? secondaryTrackColor : trackColor;
            const hsl = { h: 0, s: 0, l: 0 };
            TileColorManager._reusableColor.set(baseColor).getHSL(hsl);
            // Lightness goes from 0.2 to 0.8 based on amplitude
            const volumeHex = '#' + TileColorManager._reusableColor.setHSL(hsl.h, hsl.s, 0.2 + amp * 0.6).getHexString();

            if (isNeon) {
                renderer_tileClientColor.color = "#000000";
                renderer_tileClientColor.bgcolor = volumeHex;
            } else {
                renderer_tileClientColor.color = volumeHex;
                renderer_tileClientColor.bgcolor = this.processHexColor(volumeHex)[1];
            }
            shouldDraw = 1;
        }

        // H. Default fallback
        if (shouldDraw === 0) {
            renderer_tileClientColor.color = trackColor;
            renderer_tileClientColor.bgcolor = secondaryTrackColor;
            shouldDraw = 1;
        }

        return renderer_tileClientColor;
    }

    /**
     * Interpolate between two colors using RGB space with gamma correction
     * This produces more vibrant results than HSL for glow effects
     */
    public genColor(c1: string, c2: string, t: number): string {
        const alpha = Math.max(0, Math.min(1, t));

        // Convert to RGB (reuse static objects)
        const color1 = TileColorManager._reusableColor.set(c1);
        const color2 = TileColorManager._reusableColor2.set(c2);

        // Apply gamma correction for smoother blending
        const gamma = 2.2;
        const invGamma = 1.0 / gamma;

        const r1 = Math.pow(color1.r, gamma);
        const g1 = Math.pow(color1.g, gamma);
        const b1 = Math.pow(color1.b, gamma);

        const r2 = Math.pow(color2.r, gamma);
        const g2 = Math.pow(color2.g, gamma);
        const b2 = Math.pow(color2.b, gamma);

        // Linear interpolation
        const r = Math.pow(r1 + (r2 - r1) * alpha, invGamma);
        const g = Math.pow(g1 + (g2 - g1) * alpha, invGamma);
        const b = Math.pow(b1 + (b2 - b1) * alpha, invGamma);

        // Build hex string directly without creating a new Color object
        const ri = (Math.min(255, Math.max(0, (r * 255) | 0)));
        const gi = (Math.min(255, Math.max(0, (g * 255) | 0)));
        const bi = (Math.min(255, Math.max(0, (b * 255) | 0)));
        return '#' + ((1 << 24) + (ri << 16) + (gi << 8) + bi).toString(16).slice(1);
    }

    /**
     * Generate lighter and darker variants of a color for borders
     * Matches ADOFAI original color processing logic
     */
    public processHexColor(hex: string): [string, string] {
        const color = TileColorManager._reusableColor.set(hex);

        // Generate lighter variant (for NeonLight borders)
        const lighter = TileColorManager._reusableLighter.copy(color);
        lighter.multiplyScalar(1.3); // 30% brighter
        lighter.r = Math.min(1, lighter.r);
        lighter.g = Math.min(1, lighter.g);
        lighter.b = Math.min(1, lighter.b);

        // Generate darker variant (for Standard borders)
        const darker = TileColorManager._reusableDarker.copy(color);
        darker.multiplyScalar(0.5); // 50% darker

        return [
            '#' + lighter.getHexString(), // Lighter variant
            '#' + darker.getHexString()  // Darker variant
        ];
    }

    public formatHexColor(hex: string): string {
        if (!hex) return '#ffffff';

        // Remove '#' if present to normalize
        let cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;

        // Handle 8-digit hex (RRGGBBAA) by stripping alpha
        if (cleanHex.length === 8) {
            cleanHex = cleanHex.slice(0, 6);
        }

        // Ensure it's a valid hex string length (3 or 6)
        if (cleanHex.length !== 3 && cleanHex.length !== 6) {
            // Fallback to black if invalid
            return '#000000';
        }

        return '#' + cleanHex;
    }
}
