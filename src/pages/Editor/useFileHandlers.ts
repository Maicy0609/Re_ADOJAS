import { useCallback } from "react"
import * as ADOFAI from "adofai"
import { Parsers, Structure } from "adofai"
import type { ILevelData } from "@/lib/Player/types"
import { Player } from "@/lib/Player/Player"
import { LargeFileParser } from "@/lib/LargeFileParser"

// 类型导入
type ParseProgressEvent = Structure.ParseProgressEvent;

// 使用 StringParser 作为解析器（用于小文件）
const StringParser = Parsers.StringParser
const parser = new StringParser()

// 大文件阈值 - V8 字符串限制约为 512MB，我们设置安全阈值
const LARGE_FILE_THRESHOLD = 400 * 1024 * 1024 // 400MB

// 获取加载阶段的显示文本
const getStageText = (stage: ParseProgressEvent['stage'] | string, t: (key: string) => string): string => {
  switch (stage) {
    case 'start':
      return t("loading.stage.start")
    case 'pathData':
      return t("loading.stage.pathData")
    case 'angleData':
      return t("loading.stage.angleData")
    case 'relativeAngle':
      return t("loading.stage.relativeAngle")
    case 'tilePosition':
      return t("loading.stage.tilePosition")
    case 'complete':
      return t("loading.stage.complete")
    case 'normalizing':
      return "正在预处理文件..."
    case 'scanning':
      return "正在扫描文件结构..."
    case 'extracting_angleData':
      return "正在提取角度数据..."
    case 'parsing_angleData':
      return "正在解析角度数据..."
    case 'extracting_actions':
      return "正在提取事件数据..."
    case 'parsing_settings':
      return "正在解析设置..."
    case 'parsing_actions':
      return "正在解析事件..."
    case 'parsing_decorations':
      return "正在解析装饰..."
    default:
      return t("loading.parsingLevel")
  }
}

interface UseFileHandlersProps {
  setIsLoading: (loading: boolean) => void
  setLoadingProgress: (progress: number) => void
  setLoadingStatus: (status: string) => void
  setAdofaiFile: (file: any) => void
  initializePlayer: (loadedLevel: any) => void
  settings: any
  t: (key: string) => string
  containerRef: React.RefObject<HTMLDivElement>
  fpsCounterRef: React.RefObject<HTMLDivElement>
  infoRef: React.RefObject<HTMLDivElement>
  previewerRef: React.MutableRefObject<Player | null>
}

export function useFileHandlers({
  setIsLoading,
  setLoadingProgress,
  setLoadingStatus,
  setAdofaiFile,
  initializePlayer,
  settings,
  t,
  containerRef,
  fpsCounterRef,
  infoRef,
  previewerRef
}: UseFileHandlersProps) {
  
  // 辅助函数：初始化玩家并合成打拍音
  const initializePlayerWithHitsounds = async (loadedLevel: any): Promise<void> => {
    initializePlayer(loadedLevel)
    
    // Synthesize hitsounds with progress display
    if (previewerRef.current) {
      setLoadingProgress(96)
      setLoadingStatus(t("loading.synthesizingHitsounds"))
      
      await previewerRef.current.preSynthesizeHitsoundsWithProgress((percent) => {
        // Map 0-100 to 96-100
        const mappedPercent = 96 + (percent / 100) * 4
        setLoadingProgress(mappedPercent)
      })
    }
  }

  // 大文件加载 - 使用 LargeFileParser 直接从 ArrayBuffer 解析
  const loadLargeFile = async (arrayBuffer: ArrayBuffer): Promise<void> => {
    console.log('[DEBUG] Using LargeFileParser for large file')
    setLoadingStatus("正在预处理大文件...")
    setLoadingProgress(0)

    try {
      // 创建大文件解析器
      const largeFileParser = new LargeFileParser((stage, percent) => {
        setLoadingStatus(getStageText(stage, t))
        setLoadingProgress(Math.round(percent * 0.8)) // 0-80% for parsing
      })

      // 解析文件
      const parsedData = largeFileParser.parse(arrayBuffer)
      console.log('[DEBUG] LargeFileParser result:', {
        hasAngleData: !!parsedData.angleData,
        angleDataLength: parsedData.angleData?.length,
        hasSettings: !!parsedData.settings,
        hasActions: !!parsedData.actions,
        actionsLength: parsedData.actions?.length
      })

      // 使用解析后的数据创建 Level
      const level = new ADOFAI.Level(parsedData, undefined)

      // 监听进度事件
      level.on("parse:progress", (progressEvent: ParseProgressEvent): void => {
        setLoadingProgress(80 + Math.round(progressEvent.percent * 0.15))
        setLoadingStatus(getStageText(progressEvent.stage, t))
      })

      level.on("load", async (loadedLevel: any): Promise<void> => {
        // 计算瓦片位置
        loadedLevel.on("parse:progress", (progressEvent: ParseProgressEvent): void => {
          setLoadingProgress(80 + Math.round(progressEvent.percent * 0.15))
          setLoadingStatus(getStageText(progressEvent.stage, t))
        })
        loadedLevel.calculateTilePosition()

        setLoadingProgress(95)
        setLoadingStatus(t("loading.buildingScene"))

        // Initialize player and synthesize hitsounds
        await initializePlayerWithHitsounds(loadedLevel)

        setLoadingProgress(100)
        window.showNotification?.("success", t("editor.notifications.loadSuccess"))
        setIsLoading(false)
        setLoadingProgress(0)
        setLoadingStatus("")
      })

      await level.load()

    } catch (error) {
      console.error('[DEBUG] LargeFileParser error:', error)
      throw error
    }
  }

  // Synchronous loading (blocks UI) - for small files
  const loadSync = (content: string): void => {
    const level = new ADOFAI.Level(content, parser)
    
    // 监听进度事件
    level.on("parse:progress", (progressEvent: ParseProgressEvent): void => {
      setLoadingProgress(progressEvent.percent)
      setLoadingStatus(getStageText(progressEvent.stage, t))
    })
    
    level.on("load", async (loadedLevel: any): Promise<void> => {
      // 计算瓦片位置时也会触发进度事件
      loadedLevel.on("parse:progress", (progressEvent: ParseProgressEvent): void => {
        setLoadingProgress(progressEvent.percent)
        setLoadingStatus(getStageText(progressEvent.stage, t))
      })
      loadedLevel.calculateTilePosition()
      
      setLoadingProgress(95)
      setLoadingStatus(t("loading.buildingScene"))
      
      // Initialize player and synthesize hitsounds
      await initializePlayerWithHitsounds(loadedLevel)
      
      setLoadingProgress(100)
      window.showNotification?.("success", t("editor.notifications.loadSuccess"))
      setIsLoading(false)
      setLoadingProgress(0)
      setLoadingStatus("")
    })
    
    level.load()
  }

  // Asynchronous loading (non-blocking) - for small files
  const loadAsync = async (content: string): Promise<void> => {
    const level = new ADOFAI.Level(content, parser)
    
    // 监听进度事件
    level.on("parse:progress", (progressEvent: ParseProgressEvent): void => {
      setLoadingProgress(progressEvent.percent)
      setLoadingStatus(getStageText(progressEvent.stage, t))
    })
    
    level.on("load", async (loadedLevel: any): Promise<void> => {
      // 计算瓦片位置时也会触发进度事件
      loadedLevel.on("parse:progress", (progressEvent: ParseProgressEvent): void => {
        setLoadingProgress(progressEvent.percent)
        setLoadingStatus(getStageText(progressEvent.stage, t))
      })
      loadedLevel.calculateTilePosition()
      
      setLoadingProgress(95)
      setLoadingStatus(t("loading.buildingScene"))
      
      // Initialize player and synthesize hitsounds
      await initializePlayerWithHitsounds(loadedLevel)
      
      setLoadingProgress(100)
      window.showNotification?.("success", t("editor.notifications.loadSuccess"))
      setIsLoading(false)
      setLoadingProgress(0)
      setLoadingStatus("")
    })
    
    await level.load()
  }

  // Worker loading (background thread) - for small/medium files
  const loadWithWorker = async (content: string): Promise<void> => {
    // Check if running on file:// protocol - workers don't work there
    if (window.location.protocol === 'file:') {
      console.log('file:// protocol detected, falling back to async loading')
      window.showNotification?.("warning", "Worker mode not supported on file:// protocol, using async mode")
      await loadAsync(content)
      return
    }

    setLoadingProgress(0)
    setLoadingStatus(t("loading.stage.start"))
    
    try {
      // Create worker - correct path to src/lib/Player/levelLoaderWorker.ts
      const worker = new Worker(
        new URL('../../lib/Player/levelLoaderWorker', import.meta.url),
        { type: 'module' }
      )
      
      worker.onmessage = async (e) => {
        const { type, progress, status, stage, current, total, data, error } = e.data
        
        if (type === 'progress') {
          setLoadingProgress(progress)
          // Use translated stage text
          setLoadingStatus(getStageText(stage, t))
        } else if (type === 'result') {
          const { levelData } = data
          
          setLoadingProgress(95)
          setLoadingStatus(t("loading.buildingScene"))
          
          // Create player and synthesize hitsounds
          await initializePlayerWithHitsounds(levelData)
          
          setLoadingProgress(100)
          window.showNotification?.("success", t("editor.notifications.loadSuccess"))
          setIsLoading(false)
          setLoadingProgress(0)
          setLoadingStatus("")
          
          worker.terminate()
        } else if (type === 'error') {
          console.error('Worker error:', error)
          window.showNotification?.("error", `${t("editor.notifications.loadError")}: ${error}`)
          setIsLoading(false)
          setLoadingProgress(0)
          setLoadingStatus("")
          worker.terminate()
        }
      }
      
      worker.onerror = (error) => {
        console.error('Worker onerror:', error.message, error.filename, error.lineno)
        window.showNotification?.("error", `Worker failed: ${error.message}`)
        setIsLoading(false)
        setLoadingProgress(0)
        setLoadingStatus("")
        worker.terminate()
      }
      
      // Start loading
      worker.postMessage({ type: 'load', content })
      
    } catch (error) {
      console.error('Failed to create worker:', error)
      // Fallback to async loading
      await loadAsync(content)
    }
  }

  // 文件加载处理
  const handleFileLoad = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0]
      if (!file) return

      setIsLoading(true)
      setLoadingProgress(0)
      setLoadingStatus(t("loading.parsingLevel"))

      const reader = new FileReader()

      reader.onload = async (e): Promise<void> => {
        try {
          console.log('[DEBUG] File loaded, starting parse...')
          
          // Get ArrayBuffer directly
          const arrayBuffer = e.target?.result as ArrayBuffer
          const fileSize = arrayBuffer?.byteLength || 0
          console.log('[DEBUG] ArrayBuffer size:', fileSize)
          
          // 判断是否为大文件
          const isLargeFile = fileSize > LARGE_FILE_THRESHOLD
          console.log('[DEBUG] Is large file:', isLargeFile, '(threshold:', LARGE_FILE_THRESHOLD, ')')

          if (isLargeFile) {
            // 大文件：直接使用 ArrayBuffer 解析，不转换为字符串
            console.log('[DEBUG] Using large file parser')
            await loadLargeFile(arrayBuffer)
          } else {
            // 小文件：转换为字符串后解析
            const decoder = new TextDecoder('utf-8')
            const content = decoder.decode(arrayBuffer)
            console.log('[DEBUG] Content length:', content?.length)
            
            // Choose loading method based on settings
            if (settings.loadMethod === 'worker') {
              console.log('[DEBUG] Using worker loading')
              await loadWithWorker(content)
            } else if (settings.loadMethod === 'async') {
              console.log('[DEBUG] Using async loading')
              await loadAsync(content)
            } else {
              console.log('[DEBUG] Using sync loading')
              loadSync(content)
            }
          }
        } catch (error) {
          console.error('[DEBUG] Loading error:', error)
          window.showNotification?.("error", t("editor.notifications.loadError"))
          console.error(error)
          setIsLoading(false)
          setLoadingProgress(0)
          setLoadingStatus("")
        }
      }

      reader.onerror = (): void => {
        window.showNotification?.("error", t("editor.notifications.fileReadError"))
        setIsLoading(false)
        setLoadingProgress(0)
        setLoadingStatus("")
      }

      // Always use readAsArrayBuffer
      reader.readAsArrayBuffer(file)
    },
    [t, settings, setIsLoading, setLoadingProgress, setLoadingStatus]
  )

  // 音频加载处理
  const handleAudioLoad = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0]
      if (!file) return

      const url = URL.createObjectURL(file)
      
      if (previewerRef.current) {
          previewerRef.current.loadMusic(url)
          window.showNotification?.("success", "Audio loaded successfully")
      } else {
          window.showNotification?.("warning", "Please load a level first")
      }
    },
    [previewerRef]
  )

  // 视频加载处理
  const handleVideoLoad = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0]
      if (!file) return

      const url = URL.createObjectURL(file)
      
      if (previewerRef.current) {
          previewerRef.current.loadVideo(url)
          window.showNotification?.("success", "Video loaded successfully")
      } else {
          window.showNotification?.("warning", "Please load a level first")
      }
    },
    [previewerRef]
  )

  // 导出文件功能
  const handleExport = useCallback((): void => {
    if (!previewerRef.current) {
      window.showNotification?.("error", t("editor.notifications.noFileToExport"))
      return
    }

    try {
      const adofaiFile = (previewerRef.current as any).levelData
      const exportData = JSON.stringify(adofaiFile, null, 2)
      const blob = new Blob([exportData], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "level.adofai"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      window.showNotification?.("success", t("editor.notifications.exportSuccess"))
    } catch (error) {
      console.error("Export error:", error)
      window.showNotification?.("error", t("editor.notifications.exportError"))
    }
  }, [t, previewerRef])

  return {
    handleFileLoad,
    handleAudioLoad,
    handleVideoLoad,
    handleExport
  }
}
