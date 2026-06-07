import { useState, useRef, useEffect, useCallback } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Video, Upload, Circle, Square, RotateCcw, Check, Loader2 } from 'lucide-react';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export default function VideoSubmission({ assignmentId, classId, teacherId, user, onComplete }) {
  const [mode, setMode] = useState(null); // 'upload' | 'record'
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [stream, setStream] = useState(null);
  const videoPreviewRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const fileInputRef = useRef(null);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [stream]);

  const handleFileSelect = (e) => {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Please select an MP4, MOV, or WebM video file.');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError('Video must be under 500MB.');
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const startRecording = async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(mediaStream);
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = mediaStream;
        videoPreviewRef.current.play();
      }

      const recorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecordedBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
        mediaStream.getTracks().forEach(t => t.stop());
        setStream(null);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Camera access error:', err);
      setError('Could not access camera. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const resetRecording = () => {
    setRecordedBlob(null);
    setPreviewUrl(null);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
  };

  const handleSubmit = async () => {
    const videoFile = file || recordedBlob;
    if (!videoFile || !user) return;

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const ext = file ? file.name.split('.').pop() : 'webm';
      const jobId = `video_${Date.now()}`;
      const storagePath = `videoSubmissions/${user.uid}/${jobId}.${ext}`;
      const storageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(storageRef, videoFile);

      await new Promise((resolve, reject) => {
        uploadTask.on('state_changed',
          (snap) => setUploadProgress((snap.bytesTransferred / snap.totalBytes) * 100),
          reject,
          resolve
        );
      });

      const videoUrl = await getDownloadURL(storageRef);

      // Create grading job
      await addDoc(collection(db, 'gradingJobs'), {
        assignmentId,
        classId,
        teacherId,
        studentId: user.uid,
        status: 'complete',
        submissionType: 'video',
        videoUrl,
        storagePath,
        requiresManualGrading: true,
        score: null,
        createdAt: serverTimestamp(),
      });

      if (onComplete) onComplete();
    } catch (err) {
      console.error('Video upload error:', err);
      setError('Upload failed. Check file size (<500MB) and try again.');
    } finally {
      setIsUploading(false);
    }
  };

  // Mode selection
  if (!mode) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Submit a Video</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setMode('upload')}
            className="flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">Upload Video</span>
            <span className="text-[10px] text-muted-foreground">MP4, MOV, WebM · max 500MB</span>
          </button>
          <button
            onClick={() => { setMode('record'); }}
            className="flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <Video className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">Record Video</span>
            <span className="text-[10px] text-muted-foreground">Use your webcam</span>
          </button>
        </div>
      </div>
    );
  }

  // Upload mode
  if (mode === 'upload') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Upload Video</p>
          <Button variant="ghost" size="sm" onClick={() => { setMode(null); setFile(null); setPreviewUrl(null); }}>Back</Button>
        </div>

        {!file ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-2 p-8 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Click to select a video file</span>
            <span className="text-[10px] text-muted-foreground">MP4, MOV, or WebM · max 500MB</span>
            <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleFileSelect} />
          </div>
        ) : (
          <div className="space-y-3">
            <video src={previewUrl} controls className="w-full rounded-xl bg-black max-h-64" />
            <p className="text-xs text-muted-foreground">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>
          </div>
        )}

        {error && <Alert variant="destructive" className="py-2"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}

        {isUploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Uploading...</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        {file && !isUploading && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setFile(null); setPreviewUrl(null); }}>Change File</Button>
            <Button size="sm" onClick={handleSubmit}>
              <Upload className="h-3 w-3 mr-1" /> Submit Video
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Record mode
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Record Video</p>
        <Button variant="ghost" size="sm" onClick={() => { setMode(null); resetRecording(); }}>Back</Button>
      </div>

      <div className="rounded-xl overflow-hidden bg-black aspect-video relative">
        {!recordedBlob ? (
          <video ref={videoPreviewRef} muted className="w-full h-full object-cover" />
        ) : (
          <video src={previewUrl} controls className="w-full h-full object-cover" />
        )}
        {isRecording && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
            <Circle className="h-2 w-2 fill-current" /> REC
          </div>
        )}
      </div>

      {error && <Alert variant="destructive" className="py-2"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}

      {isUploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Uploading...</span>
            <span>{Math.round(uploadProgress)}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </div>
      )}

      <div className="flex gap-2">
        {!isRecording && !recordedBlob && (
          <Button size="sm" variant="destructive" onClick={startRecording}>
            <Circle className="h-3 w-3 mr-1 fill-current" /> Start Recording
          </Button>
        )}
        {isRecording && (
          <Button size="sm" variant="destructive" onClick={stopRecording}>
            <Square className="h-3 w-3 mr-1 fill-current" /> Stop
          </Button>
        )}
        {recordedBlob && !isUploading && (
          <>
            <Button size="sm" variant="outline" onClick={resetRecording}>
              <RotateCcw className="h-3 w-3 mr-1" /> Re-record
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              <Check className="h-3 w-3 mr-1" /> Use This Video
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
