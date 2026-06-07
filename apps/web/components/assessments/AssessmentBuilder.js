import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuth } from '@/lib/auth-context'
import { DEFAULT_ASSESSMENT, QUESTION_TYPES } from '@/lib/assessments/types'
import { parseCSV, generateCSVTemplate, parseQTI } from '@/lib/assessments/importParser'
import QuestionList from '@/components/assessments/QuestionList'
import QuestionEditor from '@/components/assessments/QuestionEditor'
import AssessmentSettings from '@/components/assessments/AssessmentSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  ArrowLeft,
  Save,
  Eye,
  MoreHorizontal,
  Upload,
  Download,
  Trash2,
  Plus,
  FileUp,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react'

function generateId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
}

export default function AssessmentBuilder({ assessmentId: initialId, initialData }) {
  const router = useRouter()
  const { user } = useAuth()

  const [assessmentId, setAssessmentId] = useState(initialId || null)
  const [settings, setSettings] = useState({ ...DEFAULT_ASSESSMENT, ...initialData })
  const [questions, setQuestions] = useState([])
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(!!initialId)
  const [classes, setClasses] = useState([])
  const [saveStatus, setSaveStatus] = useState('saved') // 'saved' | 'saving' | 'unsaved'
  const [importOpen, setImportOpen] = useState(false)
  const [importTab, setImportTab] = useState('csv')
  const [importedQuestions, setImportedQuestions] = useState([])
  const [importError, setImportError] = useState(null)
  const [deleteUndo, setDeleteUndo] = useState(null)

  const debounceRef = useRef(null)
  const deleteTimeoutRef = useRef(null)
  const hasInitialLoad = useRef(false)

  // Load classes for settings panel
  useEffect(() => {
    if (!user) return
    const loadClasses = async () => {
      const snap = await getDocs(
        query(collection(db, 'classes'), orderBy('createdAt', 'desc'))
      )
      const allClasses = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => c.teacherId === user.uid)
      setClasses(allClasses)
    }
    loadClasses()
  }, [user])

  // Load existing assessment
  useEffect(() => {
    if (!initialId || !user) return
    const load = async () => {
      try {
        const assessDoc = await getDoc(doc(db, 'assessments', initialId))
        if (assessDoc.exists()) {
          const data = assessDoc.data()
          setSettings({ ...DEFAULT_ASSESSMENT, ...data })
        }
        const qSnap = await getDocs(
          query(
            collection(db, 'assessments', initialId, 'questions'),
            orderBy('orderIndex', 'asc')
          )
        )
        const qs = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setQuestions(qs)
      } catch (err) {
        console.error('Failed to load assessment:', err)
      } finally {
        setLoading(false)
        hasInitialLoad.current = true
      }
    }
    load()
  }, [initialId, user])

  // Mark as loaded for new assessments
  useEffect(() => {
    if (!initialId) {
      hasInitialLoad.current = true
    }
  }, [initialId])

  // Autosave with debounce
  const saveToFirestore = useCallback(
    async (currentSettings, currentQuestions) => {
      if (!user) return
      setSaveStatus('saving')
      try {
        let docId = assessmentId
        const payload = {
          ...currentSettings,
          teacherId: user.uid,
          updatedAt: serverTimestamp(),
        }

        if (!docId) {
          payload.createdAt = serverTimestamp()
          const ref = await addDoc(collection(db, 'assessments'), payload)
          docId = ref.id
          setAssessmentId(docId)
          const cid = router.query.classId || currentSettings.classId
          router.replace(`/teacher/class/${cid}/assessments/${docId}`, undefined, { shallow: true })
        } else {
          await setDoc(doc(db, 'assessments', docId), payload, { merge: true })
        }

        // Save questions
        const batch = writeBatch(db)
        for (const q of currentQuestions) {
          const qRef = doc(db, 'assessments', docId, 'questions', q.id)
          batch.set(qRef, { ...q, updatedAt: serverTimestamp() }, { merge: true })
        }
        await batch.commit()

        setSaveStatus('saved')
      } catch (err) {
        console.error('Save failed:', err)
        setSaveStatus('unsaved')
      }
    },
    [user, assessmentId, router]
  )

  const debouncedSave = useCallback(
    (newSettings, newQuestions) => {
      setSaveStatus('unsaved')
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        saveToFirestore(newSettings, newQuestions)
      }, 2000)
    },
    [saveToFirestore]
  )

  // Trigger autosave on changes
  useEffect(() => {
    if (!hasInitialLoad.current) return
    debouncedSave(settings, questions)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [settings, questions, debouncedSave])

  const handleSettingsChange = (partialSettings) => {
    setSettings(prev => ({ ...prev, ...partialSettings }))
  }

  const handleAddQuestion = (type) => {
    const newQ = {
      id: generateId(),
      type,
      orderIndex: questions.length,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      media: [],
      points: 1,
      required: true,
      choices: type === 'multiple_choice' ? [
        { id: generateId(), content: { type: 'doc', content: [{ type: 'paragraph' }] }, isCorrect: false, orderIndex: 0, explanation: null },
        { id: generateId(), content: { type: 'doc', content: [{ type: 'paragraph' }] }, isCorrect: false, orderIndex: 1, explanation: null },
      ] : type === 'true_false' ? [
        { id: generateId(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'True' }] }] }, isCorrect: false, orderIndex: 0, explanation: null },
        { id: generateId(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'False' }] }] }, isCorrect: false, orderIndex: 1, explanation: null },
      ] : [],
      codingLanguage: type === 'coding' ? 'javascript' : null,
      codingStarterCode: type === 'coding' ? '' : null,
      codingTestCases: type === 'coding' ? [] : null,
      codingShowTestCases: type === 'coding' ? true : false,
      allowPartialCredit: false,
      autoGrade: type !== 'essay',
      caseSensitive: false,
      acceptedAnswers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setQuestions((prev) => [...prev, newQ])
    setEditingQuestion(newQ)
    setEditorOpen(true)
  }

  const handleEditQuestion = (question) => {
    setEditingQuestion(question)
    setEditorOpen(true)
  }

  const handleSaveQuestion = (updatedQuestion) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === updatedQuestion.id ? { ...updatedQuestion, updatedAt: new Date().toISOString() } : q))
    )
    setEditorOpen(false)
    setEditingQuestion(null)
  }

  const handleDuplicateQuestion = (question) => {
    const copy = {
      ...question,
      id: generateId(),
      orderIndex: question.orderIndex + 0.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setQuestions((prev) => {
      const updated = [...prev, copy].sort((a, b) => a.orderIndex - b.orderIndex)
      return updated.map((q, i) => ({ ...q, orderIndex: i }))
    })
  }

  const handleDeleteQuestion = (questionId) => {
    const deleted = questions.find((q) => q.id === questionId)
    if (!deleted) return
    setQuestions((prev) => prev.filter((q) => q.id !== questionId))
    setDeleteUndo({ question: deleted })

    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current)
    deleteTimeoutRef.current = setTimeout(async () => {
      setDeleteUndo(null)
      if (assessmentId) {
        try {
          await deleteDoc(doc(db, 'assessments', assessmentId, 'questions', questionId))
        } catch (err) {
          console.error('Failed to delete question from Firestore:', err)
        }
      }
    }, 5000)
  }

  const handleUndoDelete = () => {
    if (!deleteUndo) return
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current)
    setQuestions((prev) =>
      [...prev, deleteUndo.question].sort((a, b) => a.orderIndex - b.orderIndex)
    )
    setDeleteUndo(null)
  }

  const handleReorder = (newQuestions) => {
    const reordered = newQuestions.map((q, i) => ({ ...q, orderIndex: i }))
    setQuestions(reordered)
  }

  // Import handlers
  const handleCSVFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null)
    try {
      const parsed = await parseCSV(file)
      setImportedQuestions(parsed)
    } catch (err) {
      setImportError(err.message)
      setImportedQuestions([])
    }
  }

  const handleQTIFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError(null)
    try {
      const text = await file.text()
      const parsed = await parseQTI(text)
      setImportedQuestions(parsed)
    } catch (err) {
      setImportError(err.message)
      setImportedQuestions([])
    }
  }

  const confirmImport = () => {
    const withOrder = importedQuestions.map((q, i) => ({
      ...q,
      id: q.id || generateId(),
      orderIndex: questions.length + i,
    }))
    setQuestions((prev) => [...prev, ...withOrder])
    setImportedQuestions([])
    setImportOpen(false)
  }

  // Publish / unpublish
  const handleTogglePublish = async () => {
    const newStatus = settings.status === 'published' ? 'draft' : 'published'
    setSettings((prev) => ({ ...prev, status: newStatus }))
  }

  // Delete assessment
  const handleDelete = async () => {
    const cid = router.query.classId || settings.classId
    const listHref = cid ? `/teacher/class/${cid}/assessments` : '/teacher/dashboard'
    if (!assessmentId) {
      router.push(listHref)
      return
    }
    if (!confirm('Are you sure you want to delete this assessment? This cannot be undone.')) return
    try {
      // Delete questions subcollection
      const qSnap = await getDocs(collection(db, 'assessments', assessmentId, 'questions'))
      const batch = writeBatch(db)
      qSnap.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(doc(db, 'assessments', assessmentId))
      await batch.commit()
      router.push(listHref)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  // Save status display
  const saveStatusText = {
    saved: 'All changes saved',
    saving: 'Saving...',
    unsaved: 'Unsaved changes',
  }

  const saveStatusIcon = {
    saved: <CheckCircle2 className="w-3 h-3 text-green-500" />,
    saving: <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />,
    unsaved: <AlertCircle className="w-3 h-3 text-yellow-500" />,
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Head>
          <title>Loading Assessment... | TikiTaka</title>
        </Head>
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <div className="h-10 w-64 bg-muted animate-pulse rounded" />
          <div className="flex gap-6">
            <div className="flex-1 space-y-4">
              <div className="h-32 bg-muted animate-pulse rounded" />
              <div className="h-32 bg-muted animate-pulse rounded" />
            </div>
            <div className="w-[30%] h-96 bg-muted animate-pulse rounded hidden lg:block" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Head>
        <title>{settings.title || 'New Assessment'} | TikiTaka</title>
      </Head>

      {/* Top Bar */}
      <div className="sticky top-0 z-40 bg-background border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const cid = router.query.classId || settings.classId
              router.push(cid ? `/teacher/class/${cid}/assessments` : '/teacher/dashboard')
            }}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="flex-1 min-w-0">
            <Input
              value={settings.title}
              onChange={(e) => handleSettingsChange({ ...settings, title: e.target.value })}
              placeholder="Untitled Assessment"
              className="text-lg font-semibold border-none shadow-none px-2 h-auto focus-visible:ring-0"
              autoFocus={!initialId}
            />
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            {saveStatusIcon[saveStatus]}
            <span className="hidden sm:inline">{saveStatusText[saveStatus]}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {assessmentId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const cid = router.query.classId || settings.classId
                  router.push(`/teacher/class/${cid}/assessments/${assessmentId}/preview`)
                }}
              >
                <Eye className="w-4 h-4 mr-1" />
                Preview
              </Button>
            )}

            <Button
              variant={settings.status === 'published' ? 'destructive' : 'default'}
              size="sm"
              onClick={handleTogglePublish}
            >
              {settings.status === 'published' ? 'Unpublish' : 'Publish'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Import Questions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  if (typeof generateCSVTemplate === 'function') {
                    const blob = new Blob([generateCSVTemplate()], { type: 'text/csv' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'assessment_template.csv'
                    a.click()
                    URL.revokeObjectURL(url)
                  }
                }}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Template
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Assessment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Panel - Questions */}
          <div className="flex-1 lg:w-[70%] min-w-0">
            {questions.length === 0 ? (
              <div className="border-2 border-dashed rounded-lg p-12 text-center">
                <Plus className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Add your first question</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Choose a question type to get started
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {Object.entries(QUESTION_TYPES).map(([type, { label }]) => (
                    <Button
                      key={type}
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddQuestion(type)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <QuestionList
                questions={questions}
                onReorder={handleReorder}
                onEditQuestion={handleEditQuestion}
                onDuplicateQuestion={handleDuplicateQuestion}
                onDeleteQuestion={handleDeleteQuestion}
                onAddQuestion={handleAddQuestion}
              />
            )}

            {/* Undo delete toast */}
            {deleteUndo && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                <Alert className="flex items-center gap-3 pr-3 shadow-lg">
                  <AlertDescription className="flex items-center gap-3">
                    Question deleted.
                    <Button variant="link" size="sm" className="p-0 h-auto" onClick={handleUndoDelete}>
                      Undo
                    </Button>
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>

          {/* Right Panel - Settings */}
          <div className="lg:w-[30%] shrink-0">
            <div className="lg:sticky lg:top-20">
              <AssessmentSettings
                settings={settings}
                onSettingsChange={handleSettingsChange}
                classes={classes}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Question Editor Dialog */}
      {editingQuestion && (
        <QuestionEditor
          question={editingQuestion}
          onSave={handleSaveQuestion}
          onCancel={() => {
            setEditorOpen(false)
            setEditingQuestion(null)
          }}
          isOpen={editorOpen}
        />
      )}

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Questions</DialogTitle>
            <DialogDescription>
              Import questions from a CSV file or QTI package.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={importTab} onValueChange={setImportTab}>
            <TabsList className="w-full">
              <TabsTrigger value="csv" className="flex-1">CSV Import</TabsTrigger>
              <TabsTrigger value="qti" className="flex-1">QTI Import</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-4 mt-4">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (typeof generateCSVTemplate === 'function') {
                      const blob = new Blob([generateCSVTemplate()], { type: 'text/csv' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = 'assessment_template.csv'
                      a.click()
                      URL.revokeObjectURL(url)
                    }
                  }}
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download Template
                </Button>
              </div>

              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <FileUp className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-2">Drop a CSV file here or click to browse</p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVFile}
                  className="block w-full text-sm text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer"
                />
              </div>

              {importError && (
                <Alert variant="destructive">
                  <AlertDescription>{importError}</AlertDescription>
                </Alert>
              )}

              {importedQuestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {importedQuestions.length} question{importedQuestions.length !== 1 ? 's' : ''} found
                  </p>
                  <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                    {importedQuestions.map((q, i) => (
                      <div key={i} className="text-xs flex justify-between items-center py-1 border-b last:border-0">
                        <span className="truncate flex-1">{q.content?.content?.[0]?.content?.[0]?.text || `Question ${i + 1}`}</span>
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          {QUESTION_TYPES[q.type]?.label || q.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="qti" className="space-y-4 mt-4">
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <FileUp className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-2">Upload a QTI XML or ZIP file</p>
                <input
                  type="file"
                  accept=".xml,.zip"
                  onChange={handleQTIFile}
                  className="block w-full text-sm text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer"
                />
              </div>

              {importError && (
                <Alert variant="destructive">
                  <AlertDescription>{importError}</AlertDescription>
                </Alert>
              )}

              {importedQuestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {importedQuestions.length} question{importedQuestions.length !== 1 ? 's' : ''} found
                  </p>
                  <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                    {importedQuestions.map((q, i) => (
                      <div key={i} className="text-xs flex justify-between items-center py-1 border-b last:border-0">
                        <span className="truncate flex-1">{q.content?.content?.[0]?.content?.[0]?.text || `Question ${i + 1}`}</span>
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          {QUESTION_TYPES[q.type]?.label || q.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportedQuestions([]); setImportError(null) }}>
              Cancel
            </Button>
            <Button
              onClick={confirmImport}
              disabled={importedQuestions.length === 0}
            >
              Import {importedQuestions.length} Question{importedQuestions.length !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
