import { useState } from 'react'
import axios from 'axios'

export default function useUpload({ onCreated }) {
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadErrors, setUploadErrors] = useState([])

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) {
      return
    }

    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    try {
      setUploadProgress(0)
      setUploadMessage(`Uploading ${files.length} meme${files.length === 1 ? '' : 's'}...`)
      setUploadErrors([])

      const response = await axios.post('/api/memes/upload', formData, {
        onUploadProgress: (event) => {
          const nextProgress = event.total
            ? Math.round((event.loaded / event.total) * 100)
            : 0
          setUploadProgress(nextProgress)
        }
      })

      const items = response.data?.items || []
      const created = items.filter((item) => item.status === 'created')
      const errors = items
        .filter((item) => item.status === 'error')
        .map((item) => `${item.filename}: ${item.error}`)

      setUploadErrors(errors)
      setUploadProgress(created.length ? 100 : 0)

      if (created.length) {
        setUploadMessage(
          `${created.length} meme${created.length === 1 ? '' : 's'} uploaded. Analysis is running in the background.`
        )
        onCreated(created)
      } else {
        setUploadMessage('No files were uploaded.')
      }
    } catch (error) {
      const message =
        error.response?.data?.error?.message ||
        error.response?.data?.detail ||
        'Upload failed.'
      setUploadMessage(message)
      setUploadErrors([message])
      setUploadProgress(0)
    }
  }

  return {
    uploadProgress,
    uploadMessage,
    uploadErrors,
    uploadFiles
  }
}
