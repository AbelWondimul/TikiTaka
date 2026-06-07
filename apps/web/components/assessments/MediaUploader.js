import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImagePlus, Video, X } from 'lucide-react'

export default function MediaUploader({ media = [], onMediaChange }) {
  const fileInputRef = useRef(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [showVideoInput, setShowVideoInput] = useState(false)

  function generateId() {
    return Math.random().toString(36).slice(2, 10)
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const newMedia = [
          ...media,
          {
            id: generateId(),
            type: 'image',
            url: event.target.result,
            alt: file.name.replace(/\.[^.]+$/, ''),
            width: img.width,
            height: img.height,
          },
        ]
        onMediaChange?.(newMedia)
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function parseVideoUrl(url) {
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/)
    if (ytMatch) {
      return { embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}`, thumbnail: `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg` }
    }
    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
    if (vimeoMatch) {
      return { embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`, thumbnail: null }
    }
    return null
  }

  function handleAddVideo() {
    if (!videoUrl.trim()) return
    const parsed = parseVideoUrl(videoUrl)
    if (!parsed) {
      alert('Please enter a valid YouTube or Vimeo URL.')
      return
    }
    const newMedia = [
      ...media,
      {
        id: generateId(),
        type: 'video',
        url: parsed.embedUrl,
        alt: '',
        width: 560,
        height: 315,
      },
    ]
    onMediaChange?.(newMedia)
    setVideoUrl('')
    setShowVideoInput(false)
  }

  function handleVideoKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddVideo()
    }
  }

  function handleRemove(id) {
    onMediaChange?.(media.filter((m) => m.id !== id))
  }

  function handleAltChange(id, alt) {
    onMediaChange?.(media.map((m) => (m.id === id ? { ...m, alt } : m)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus className="h-4 w-4 mr-2" />
          Upload Image
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowVideoInput(!showVideoInput)}>
          <Video className="h-4 w-4 mr-2" />
          Embed Video
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />
      </div>

      {showVideoInput && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Paste YouTube or Vimeo URL..."
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyDown={handleVideoKeyDown}
            className="flex-1"
          />
          <Button size="sm" onClick={handleAddVideo}>
            Add
          </Button>
        </div>
      )}

      {media.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {media.map((item) => (
            <div key={item.id} className="border rounded-lg p-2 space-y-2 relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6"
                onClick={() => handleRemove(item.id)}
              >
                <X className="h-4 w-4" />
              </Button>

              {item.type === 'image' ? (
                <img
                  src={item.url}
                  alt={item.alt}
                  className="w-full h-32 object-cover rounded"
                />
              ) : (
                <iframe
                  src={item.url}
                  title={item.alt || 'Video'}
                  className="w-full h-32 rounded"
                  allowFullScreen
                />
              )}

              <Input
                placeholder="Alt text..."
                value={item.alt}
                onChange={(e) => handleAltChange(item.id, e.target.value)}
                className="text-xs h-8"
              />

              <span className="text-xs text-muted-foreground">
                {item.width} x {item.height}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
