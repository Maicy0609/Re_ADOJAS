/**
 * Large File Parser for ADOFAI - Memory Optimized Version
 *
 * Key optimization: Process the buffer in-place without creating copies.
 * The "trailing comma" handling is done on-the-fly during parsing.
 */

// BOM marker for UTF-8
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * Find the position of a property ONLY at root object level
 * This prevents finding property names inside nested arrays/objects
 */
function findPropertyAtRoot(buffer: Uint8Array, propertyName: string): number {
  const searchStr = `"${propertyName}"`;
  const searchBytes = new TextEncoder().encode(searchStr);

  let depth = 0;  // Track JSON nesting depth
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < buffer.length - searchBytes.length; i++) {
    const byte = buffer[i];

    // Handle escape sequences
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (byte === 92) { // \
      escapeNext = true;
      continue;
    }

    // Track string boundaries
    if (byte === 34) { // "
      inString = !inString;
      continue;
    }

    // Track object/array depth (only when not in string)
    if (!inString) {
      if (byte === 123 || byte === 91) { // { or [
        depth++;
      } else if (byte === 125 || byte === 93) { // } or ]
        depth--;
      }

      // Only search for property at root level (depth === 1)
      // The root object is at depth 1, so its direct properties are at depth 1
      if (depth === 1) {
        // Check if this position matches the property name
        let match = true;
        for (let j = 0; j < searchBytes.length; j++) {
          if (buffer[i + j] !== searchBytes[j]) {
            match = false;
            break;
          }
        }

        if (match) {
          // Found property name, now find the colon and value
          let pos = i + searchBytes.length;
          // Skip whitespace
          while (pos < buffer.length && (buffer[pos] === 32 || buffer[pos] === 9 || buffer[pos] === 10 || buffer[pos] === 13)) {
            pos++;
          }
          if (buffer[pos] === 58) { // colon
            pos++;
            // Skip whitespace after colon
            while (pos < buffer.length && (buffer[pos] === 32 || buffer[pos] === 9 || buffer[pos] === 10 || buffer[pos] === 13)) {
              pos++;
            }
            return pos;
          }
        }
      }
    }
  }

  return -1;
}

/**
 * Find the end of a JSON value, handling trailing commas
 */
function findValueEnd(buffer: Uint8Array, startPos: number): number {
  if (startPos >= buffer.length) return -1;

  const firstChar = buffer[startPos];

  // String
  if (firstChar === 34) { // "
    let i = startPos + 1;
    let escapeNext = false;
    while (i < buffer.length) {
      if (escapeNext) {
        escapeNext = false;
        i++;
        continue;
      }
      if (buffer[i] === 92) {
        escapeNext = true;
        i++;
        continue;
      }
      if (buffer[i] === 34) {
        return i + 1;
      }
      i++;
    }
    return -1;
  }

  // Array or Object
  if (firstChar === 91 || firstChar === 123) { // [ or {
    const openChar = firstChar;
    const closeChar = firstChar === 91 ? 93 : 125; // ] or }
    let depth = 0;
    let i = startPos;
    let inString = false;
    let escapeNext = false;

    while (i < buffer.length) {
      if (escapeNext) {
        escapeNext = false;
        i++;
        continue;
      }
      if (buffer[i] === 92) {
        escapeNext = true;
        i++;
        continue;
      }
      if (buffer[i] === 34) {
        inString = !inString;
        i++;
        continue;
      }
      if (!inString) {
        if (buffer[i] === openChar) {
          depth++;
        } else if (buffer[i] === closeChar) {
          depth--;
          if (depth === 0) {
            return i + 1;
          }
        }
      }
      i++;
    }
    return -1;
  }

  // Primitive
  let i = startPos;
  while (i < buffer.length) {
    const byte = buffer[i];
    if (byte === 44 || byte === 125 || byte === 93 ||
        byte === 32 || byte === 9 || byte === 10 || byte === 13) {
      return i;
    }
    i++;
  }
  return i;
}

/**
 * Extract a JSON value as string
 */
function extractValueAsString(buffer: Uint8Array, startPos: number, endPos: number): string {
  const bytes = buffer.slice(startPos, endPos);
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

/**
 * Parse a number array incrementally, handling trailing commas
 */
function parseNumberArrayIncremental(
  buffer: Uint8Array,
  startPos: number,
  onProgress?: (percent: number) => void
): { values: number[]; endPos: number } | null {
  if (startPos >= buffer.length || buffer[startPos] !== 91) return null;

  const values: number[] = [];
  let i = startPos + 1;
  let currentValue = '';
  let depth = 1;
  let inString = false;
  let escapeNext = false;
  let lastWasComma = false;
  const totalLength = buffer.length;

  while (i < buffer.length) {
    const byte = buffer[i];

    if (escapeNext) {
      escapeNext = false;
      i++;
      continue;
    }

    if (byte === 92) {
      escapeNext = true;
      i++;
      continue;
    }

    if (byte === 34) {
      inString = !inString;
      i++;
      continue;
    }

    if (!inString) {
      if (byte === 91) {
        depth++;
        i++;
        lastWasComma = false;
      } else if (byte === 93) {
        depth--;
        if (depth === 0) {
          // Push last value if not after comma
          if (currentValue.trim() && !lastWasComma) {
            const num = Number(currentValue.trim());
            if (!isNaN(num)) {
              values.push(num);
            }
          }
          return { values, endPos: i + 1 };
        }
        i++;
        lastWasComma = false;
      } else if (byte === 44) {
        // Handle trailing comma: only push if we have a value
        if (currentValue.trim() && !lastWasComma) {
          const num = Number(currentValue.trim());
          if (!isNaN(num)) {
            values.push(num);
          }
        }
        currentValue = '';
        lastWasComma = true;
        i++;
      } else if ((byte >= 48 && byte <= 57) || byte === 45 || byte === 46) {
        currentValue += String.fromCharCode(byte);
        lastWasComma = false;
        i++;
      } else if (byte === 32 || byte === 9 || byte === 10 || byte === 13) {
        // Skip whitespace
        i++;
      } else {
        i++;
      }
    } else {
      i++;
    }

    if (onProgress && i % 5000000 === 0) {
      onProgress(Math.round((i / totalLength) * 100));
    }
  }

  return { values, endPos: i };
}

/**
 * Parse object array incrementally
 */
function parseObjectArrayIncremental(
  buffer: Uint8Array,
  startPos: number,
  onProgress?: (percent: number) => void,
  maxObjects?: number
): { values: any[]; endPos: number } | null {
  if (startPos >= buffer.length || buffer[startPos] !== 91) return null;

  const values: any[] = [];
  let i = startPos + 1;
  let depth = 1;
  let inString = false;
  let escapeNext = false;
  let objectStart = -1;
  const totalLength = buffer.length;
  let objectCount = 0;
  let lastWasComma = false;

  // Skip initial whitespace
  while (i < buffer.length && (buffer[i] === 32 || buffer[i] === 9 || buffer[i] === 10 || buffer[i] === 13)) {
    i++;
  }

  // Empty array check
  if (buffer[i] === 93) {
    return { values: [], endPos: i + 1 };
  }

  while (i < buffer.length) {
    const byte = buffer[i];

    if (escapeNext) {
      escapeNext = false;
      i++;
      continue;
    }

    if (byte === 92) {
      escapeNext = true;
      i++;
      continue;
    }

    if (byte === 34) {
      inString = !inString;
      i++;
      continue;
    }

    if (!inString) {
      if (byte === 123) { // {
        if (depth === 1 && objectStart === -1 && !lastWasComma) {
          objectStart = i;
        } else if (depth === 1 && objectStart === -1 && lastWasComma) {
          // This is after a comma, so it's a valid object start
          objectStart = i;
          lastWasComma = false;
        }
        depth++;
        i++;
      } else if (byte === 125) { // }
        depth--;
        if (depth === 1 && objectStart !== -1) {
          const objStr = extractValueAsString(buffer, objectStart, i + 1);
          try {
            const obj = JSON.parse(objStr);
            values.push(obj);
            objectCount++;

            if (maxObjects && objectCount >= maxObjects) {
              let searchPos = i + 1;
              while (searchPos < buffer.length && buffer[searchPos] !== 93) {
                searchPos++;
              }
              return { values, endPos: searchPos + 1 };
            }
          } catch (e) {
            // Skip malformed objects
          }
          objectStart = -1;

          if (onProgress && objectCount % 50000 === 0) {
            onProgress(Math.round((i / totalLength) * 100));
          }
        }
        i++;
      } else if (byte === 91) {
        depth++;
        i++;
      } else if (byte === 93) {
        depth--;
        if (depth === 0) {
          return { values, endPos: i + 1 };
        }
        i++;
      } else if (byte === 44) {
        lastWasComma = true;
        i++;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return { values, endPos: i };
}

/**
 * Memory-optimized Large File Parser
 */
export class LargeFileParser {
  private onProgress?: (stage: string, percent: number) => void;
  private skipLargeActions: boolean = false;
  private maxActions: number = 0;

  constructor(
    onProgress?: (stage: string, percent: number) => void,
    options?: { skipLargeActions?: boolean; maxActions?: number }
  ) {
    this.onProgress = onProgress;
    if (options) {
      this.skipLargeActions = options.skipLargeActions ?? false;
      this.maxActions = options.maxActions ?? 0;
    }
  }

  /**
   * Parse ArrayBuffer - NO MEMORY COPYING
   */
  parse(input: ArrayBuffer): any {
    // Create view without copying
    let view = new Uint8Array(input);

    // Strip BOM by adjusting the view
    if (view.length >= 3 && view[0] === BOM[0] && view[1] === BOM[1] && view[2] === BOM[2]) {
      view = view.subarray(3);
    }

    if (this.onProgress) this.onProgress('scanning', 5);

    // Find properties ONLY at root level
    const angleDataPos = findPropertyAtRoot(view, 'angleData');
    const pathDataPos = findPropertyAtRoot(view, 'pathData');
    const settingsPos = findPropertyAtRoot(view, 'settings');
    const actionsPos = findPropertyAtRoot(view, 'actions');
    const decorationsPos = findPropertyAtRoot(view, 'decorations');

    console.log('[LargeFileParser] Property positions:', {
      angleData: angleDataPos,
      pathData: pathDataPos,
      settings: settingsPos,
      actions: actionsPos,
      decorations: decorationsPos
    });

    const result: any = {};

    // Parse settings (small)
    if (settingsPos !== -1) {
      if (this.onProgress) this.onProgress('parsing_settings', 10);
      const settingsEnd = findValueEnd(view, settingsPos);
      if (settingsEnd !== -1) {
        const settingsStr = extractValueAsString(view, settingsPos, settingsEnd);
        try {
          result.settings = JSON.parse(settingsStr);
          console.log('[LargeFileParser] Settings parsed, hitsound:', result.settings?.hitsound);
        } catch (e) {
          console.warn('Failed to parse settings:', e);
          result.settings = {};
        }
      }
    }

    // Parse angleData
    if (angleDataPos !== -1) {
      if (this.onProgress) this.onProgress('parsing_angleData', 15);
      const angleResult = parseNumberArrayIncremental(view, angleDataPos, (p) => {
        if (this.onProgress) {
          this.onProgress('parsing_angleData', 15 + p * 0.25);
        }
      });
      if (angleResult) {
        result.angleData = angleResult.values;
        console.log(`[LargeFileParser] Parsed ${angleResult.values.length} angles`);
      }
    }

    // Parse pathData
    if (pathDataPos !== -1) {
      const pathEnd = findValueEnd(view, pathDataPos);
      if (pathEnd !== -1) {
        const pathStr = extractValueAsString(view, pathDataPos, pathEnd);
        result.pathData = pathStr.slice(1, -1);
      }
    }

    // Parse actions
    if (actionsPos !== -1) {
      const actionsEnd = findValueEnd(view, actionsPos);
      const actionsSize = actionsEnd - actionsPos;

      if (this.onProgress) this.onProgress('parsing_actions', 50);

      if (actionsSize > 100 * 1024 * 1024 && this.skipLargeActions) {
        console.log(`[LargeFileParser] Skipping large actions (${actionsSize} bytes)`);
        result.actions = [];
      } else if (actionsSize > 50 * 1024 * 1024) {
        // Parse incrementally for large arrays
        console.log(`[LargeFileParser] Parsing actions incrementally (${actionsSize} bytes)`);
        const actionsResult = parseObjectArrayIncremental(
          view,
          actionsPos,
          (p) => {
            if (this.onProgress) {
              this.onProgress('parsing_actions', 50 + p * 0.45);
            }
          },
          this.maxActions || undefined
        );
        if (actionsResult) {
          result.actions = actionsResult.values;
          console.log(`[LargeFileParser] Parsed ${actionsResult.values.length} actions`);
        }
      } else {
        // Small enough to parse directly
        const actionsStr = extractValueAsString(view, actionsPos, actionsEnd);
        try {
          result.actions = JSON.parse(actionsStr);
        } catch (e) {
          console.warn('Failed to parse actions:', e);
          result.actions = [];
        }
      }
    }

    // Parse decorations
    if (decorationsPos !== -1) {
      if (this.onProgress) this.onProgress('parsing_decorations', 95);
      const decorationsEnd = findValueEnd(view, decorationsPos);
      if (decorationsEnd !== -1) {
        const decorationsStr = extractValueAsString(view, decorationsPos, decorationsEnd);
        try {
          result.decorations = JSON.parse(decorationsStr);
        } catch (e) {
          console.warn('Failed to parse decorations:', e);
          result.decorations = [];
        }
      }
    }

    if (this.onProgress) this.onProgress('complete', 100);

    return result;
  }

  stringify(obj: any): string {
    return JSON.stringify(obj);
  }
}

export default LargeFileParser;
