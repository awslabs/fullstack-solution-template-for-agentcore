"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { FileSpreadsheet, Upload, Loader2, X, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface OrderUploadProps {
  onUploadComplete: (presignedUrl: string, fileName: string) => void
  idToken: string
  apiBaseUrl: string
}

interface UploadError {
  message: string
  type: "validation" | "upload" | "network"
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ACCEPTED_FILE_TYPES = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
}

export function OrderUpload({ onUploadComplete, idToken, apiBaseUrl }: OrderUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<UploadError | null>(null)

  const onDrop = useCallback((acceptedFiles: File[], fileRejections: { file: File; errors: { code: string }[] }[]) => {
    setError(null)

    // Handle rejected files
    if (fileRejections.length > 0) {
      const rejection = fileRejections[0]
      const errorCode = rejection.errors[0]?.code

      if (errorCode === "file-too-large") {
        setError({
          message: `ファイルサイズが大きすぎます。最大サイズは ${MAX_FILE_SIZE / (1024 * 1024)}MB です。`,
          type: "validation",
        })
      } else if (errorCode === "file-invalid-type") {
        setError({
          message: "無効なファイル形式です。Excel ファイル (.xlsx, .xls) のみ対応しています。",
          type: "validation",
        })
      } else {
        setError({
          message: "ファイルを読み込めませんでした。",
          type: "validation",
        })
      }
      return
    }

    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0])
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
  })

  const clearSelectedFile = () => {
    setSelectedFile(null)
    setError(null)
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const result = reader.result as string
        // Remove data URL prefix (e.g., "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,")
        const base64Content = result.split(",")[1]
        resolve(base64Content)
      }
      reader.onerror = (error) => reject(error)
    })
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setError(null)

    try {
      // Convert file to base64
      const fileContent = await fileToBase64(selectedFile)

      // Call presigned URL API
      const response = await fetch(`${apiBaseUrl}orders/presigned-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileContent: fileContent,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `アップロードに失敗しました (${response.status})`)
      }

      const { presignedUrl, originalFileName } = await response.json()

      // Notify parent component
      onUploadComplete(presignedUrl, originalFileName)

      // Clear selection after successful upload
      setSelectedFile(null)
    } catch (err) {
      console.error("Upload failed:", err)

      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError({
          message: "ネットワークエラーが発生しました。接続を確認してください。",
          type: "network",
        })
      } else {
        setError({
          message: err instanceof Error ? err.message : "アップロードに失敗しました。",
          type: "upload",
        })
      }
    } finally {
      setIsUploading(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <span className="text-sm">{error.message}</span>
        </div>
      )}

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed p-6 rounded-lg cursor-pointer text-center transition-colors
          ${isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
          ${selectedFile ? "border-green-500 bg-green-50" : ""}
          ${error ? "border-red-300" : ""}`}
      >
        <input {...getInputProps()} />

        <FileSpreadsheet
          className={`h-10 w-10 mx-auto mb-3 ${selectedFile ? "text-green-600" : "text-gray-400"}`}
        />

        {selectedFile ? (
          <div className="space-y-1">
            <p className="text-green-700 font-medium">{selectedFile.name}</p>
            <p className="text-sm text-green-600">{formatFileSize(selectedFile.size)}</p>
          </div>
        ) : isDragActive ? (
          <p className="text-blue-600">ドロップしてファイルを選択</p>
        ) : (
          <div className="space-y-1">
            <p className="text-gray-600">
              注文書（Excel）をドラッグ&ドロップ
              <br />
              または クリックして選択
            </p>
            <p className="text-xs text-gray-400">対応形式: .xlsx, .xls（最大 10MB）</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {selectedFile && (
        <div className="flex gap-2">
          <Button onClick={handleUpload} disabled={isUploading} className="grow">
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                アップロード中...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                注文書を監査する
              </>
            )}
          </Button>

          <Button variant="outline" onClick={clearSelectedFile} disabled={isUploading} className="px-3">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
