import { useState, useEffect, useCallback, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuth } from '@/lib/auth-context'
import { withAuth } from '@/components/layout/with-auth'
import Header from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import MathRenderer from '@/components/editor/MathRenderer'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  MinusCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Save,
} from 'lucide-react'

function GradingPage() {
  const router = useRouter()
  const { id, student: initialStudentId } = router.query
  const { user } = useAuth()

  const [assessment, setAssessment] = useState(null)
  const [questions, setQuestions] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Current student
  const [selectedStudentIdx, setSelectedStudentIdx] = useState(0)
  const [responses, setResponses] = useState([])
  const [grades, setGrades] = useState({})
  const [saving, setSaving] = useState(false)
  const [loadingResponses, setLoadingResponses] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [feedbackPresets, setFeedbackPresets] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('tikitaka-feedback-presets') || '[]') } catch { return [] }
    }
    return []
  })
  const [newPreset, setNewPreset] = useState('')
  const gradeInputRefs = useRef([])

  useEffect(() => {
    if (!id) return
    loadData()
  }, [id])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Don't handle shortcuts when typing in inputs
      const tag = e.target.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === '?' && !isInput) {
        e.preventDefault()
        setShowShortcuts(prev => !prev)
        return
      }

      if ((e.key === 'j' || e.key === 'ArrowDown') && !isInput) {
        e.preventDefault()
        setSelectedStudentIdx(i => Math.min(submissions.length - 1, i + 1))
      }
      if ((e.key === 'k' || e.key === 'ArrowUp') && !isInput) {
        e.preventDefault()
        setSelectedStudentIdx(i => Math.max(0, i - 1))
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSaveAndNext()
      }
      if (e.key === 'Tab' && !e.shiftKey && isInput) {
        const idx = gradeInputRefs.current.indexOf(e.target)
        if (idx >= 0 && idx < gradeInputRefs.current.length - 1) {
          e.preventDefault()
          gradeInputRefs.current[idx + 1]?.focus()
        }
      }
      if (e.key === 'Tab' && e.shiftKey && isInput) {
        const idx = gradeInputRefs.current.indexOf(e.target)
        if (idx > 0) {
          e.preventDefault()
          gradeInputRefs.current[idx - 1]?.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [submissions.length, selectedStudentIdx])

  // Select initial student from query param
  useEffect(() => {
    if (initialStudentId && submissions.length > 0) {
      const idx = submissions.findIndex((s) => s.studentId === initialStudentId)
      if (idx >= 0) setSelectedStudentIdx(idx)
    }
  }, [initialStudentId, submissions])

  // Load responses when selected student changes
  useEffect(() => {
    if (submissions.length > 0 && selectedStudentIdx < submissions.length) {
      loadResponses(submissions[selectedStudentIdx])
    }
  }, [selectedStudentIdx, submissions])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)

      // Load assessment
      const assessmentSnap = await getDoc(doc(db, 'assessments', id))
      if (!assessmentSnap.exists()) {
        setError('Assessment not found')
        setLoading(false)
        return
      }
      const assessmentData = { id: assessmentSnap.id, ...assessmentSnap.data() }
      setAssessment(assessmentData)

      // Load questions
      const questionsSnap = await getDocs(collection(db, 'assessments', id, 'questions'))
      const questionsData = questionsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
      setQuestions(questionsData)

      // Load submissions
      const submissionsSnap = await getDocs(collection(db, 'assessments', id, 'submissions'))
      const submissionsData = submissionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setSubmissions(submissionsData)

      // Load student profiles
      const studentIds = [...new Set(submissionsData.map((s) => s.studentId))]
      if (studentIds.length > 0) {
        const batches = []
        for (let i = 0; i < studentIds.length; i += 10) {
          batches.push(studentIds.slice(i, i + 10))
        }
        const allStudents = []
        for (const batch of batches) {
          const usersSnap = await getDocs(
            query(collection(db, 'users'), where('__name__', 'in', batch))
          )
          usersSnap.docs.forEach((d) => {
            allStudents.push({ id: d.id, ...d.data() })
          })
        }
        setStudents(allStudents)
      }
    } catch (err) {
      console.error('Error loading grading data:', err)
      setError('Failed to load grading data')
    } finally {
      setLoading(false)
    }
  }

  async function loadResponses(submission) {
    if (!submission) return
    setLoadingResponses(true)
    try {
      const responsesSnap = await getDocs(
        collection(db, 'assessments', id, 'submissions', submission.id, 'responses')
      )
      const responsesData = responsesSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setResponses(responsesData)

      // Initialize grades from existing data
      const existingGrades = {}
      responsesData.forEach((r) => {
        existingGrades[r.id] = {
          pointsEarned: r.pointsEarned ?? '',
          feedback: r.feedback || '',
        }
      })
      setGrades(existingGrades)
    } catch (err) {
      console.error('Error loading responses:', err)
    } finally {
      setLoadingResponses(false)
    }
  }

  function getStudentName(studentId) {
    const student = students.find((s) => s.id === studentId)
    return student?.displayName || student?.name || 'Unknown'
  }

  function getGradingStatus(submission) {
    if (!submission) return 'none'
    if (submission.status === 'graded') return 'graded'
    if (submission.status === 'submitted') return 'ungraded'
    return 'none'
  }

  function getStatusIcon(status) {
    switch (status) {
      case 'graded':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'ungraded':
        return <Circle className="h-4 w-4 text-amber-500 fill-amber-500" />
      default:
        return <MinusCircle className="h-4 w-4 text-gray-400 dark:text-gray-500" />
    }
  }

  const gradedCount = submissions.filter((s) => s.status === 'graded').length
  const progressPct = submissions.length ? (gradedCount / submissions.length) * 100 : 0

  const currentSubmission = submissions[selectedStudentIdx]

  async function handleSave() {
    if (!currentSubmission) return
    setSaving(true)
    try {
      // Save each response grade
      for (const [respId, grade] of Object.entries(grades)) {
        if (grade.pointsEarned !== '' || grade.feedback) {
          const respRef = doc(
            db, 'assessments', id, 'submissions', currentSubmission.id, 'responses', respId
          )
          await updateDoc(respRef, {
            pointsEarned: Number(grade.pointsEarned) || 0,
            feedback: grade.feedback,
            gradedAt: Timestamp.now(),
          })
        }
      }

      // Calculate total score
      const totalEarned = Object.values(grades).reduce(
        (sum, g) => sum + (Number(g.pointsEarned) || 0), 0
      )

      // Check if all responses are graded
      const allGraded = Object.values(grades).every((g) => g.pointsEarned !== '')

      const subRef = doc(db, 'assessments', id, 'submissions', currentSubmission.id)
      await updateDoc(subRef, {
        score: totalEarned,
        status: allGraded ? 'graded' : 'submitted',
        gradedAt: allGraded ? Timestamp.now() : null,
      })

      // Update local state
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === currentSubmission.id
            ? { ...s, score: totalEarned, status: allGraded ? 'graded' : 'submitted' }
            : s
        )
      )
    } catch (err) {
      console.error('Error saving grades:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndNext() {
    await handleSave()
    // Move to next ungraded
    const nextUngraded = submissions.findIndex(
      (s, idx) => idx > selectedStudentIdx && s.status !== 'graded'
    )
    if (nextUngraded >= 0) {
      setSelectedStudentIdx(nextUngraded)
    } else {
      // Wrap around
      const wrapUngraded = submissions.findIndex((s) => s.status !== 'graded')
      if (wrapUngraded >= 0 && wrapUngraded !== selectedStudentIdx) {
        setSelectedStudentIdx(wrapUngraded)
      }
    }
  }

  function handleCopyFeedback(text) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  if (loading) {
    return (
      <div className="flex h-screen">
        <div className="w-64 border-r p-4 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-muted animate-pulse rounded" />
          ))}
        </div>
        <div className="flex-1 p-6 space-y-4">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-destructive">{error}</p>
            <Button className="mt-4" onClick={() => router.back()}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Grade - {assessment?.title || 'Assessment'}</title>
      </Head>
      <Header />

      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-64 border-r flex flex-col bg-muted/30">
          <div className="p-4 border-b">
            <Button variant="ghost" size="sm" className="mb-2" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <h2 className="font-semibold text-sm truncate">{assessment?.title}</h2>
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">
                Graded {gradedCount} of {submissions.length}
              </p>
              <Progress value={progressPct} className="h-2" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {submissions.map((sub, idx) => {
              const status = getGradingStatus(sub)
              const isActive = idx === selectedStudentIdx
              return (
                <button
                  key={sub.id}
                  onClick={() => setSelectedStudentIdx(idx)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted'
                  }`}
                >
                  {getStatusIcon(status)}
                  <span className="truncate">{getStudentName(sub.studentId)}</span>
                </button>
              )
            })}
            {submissions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No submissions yet
              </p>
            )}
          </div>

          {/* Feedback Presets */}
          <div className="p-3 border-t space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Feedback</p>
            <div className="flex flex-wrap gap-1">
              {feedbackPresets.map((preset, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {preset.length > 20 ? preset.slice(0, 20) + '...' : preset}
                  <button onClick={() => {
                    const updated = feedbackPresets.filter((_, j) => j !== i)
                    setFeedbackPresets(updated)
                    localStorage.setItem('tikitaka-feedback-presets', JSON.stringify(updated))
                  }} className="hover:text-destructive">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <Input
                value={newPreset}
                onChange={e => setNewPreset(e.target.value)}
                placeholder="Add preset..."
                className="h-7 text-xs flex-1"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newPreset.trim()) {
                    const updated = [...feedbackPresets, newPreset.trim()]
                    setFeedbackPresets(updated)
                    localStorage.setItem('tikitaka-feedback-presets', JSON.stringify(updated))
                    setNewPreset('')
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Navigation header */}
          <div className="border-b p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSelectedStudentIdx((i) => Math.max(0, i - 1))}
                disabled={selectedStudentIdx === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSelectedStudentIdx((i) => Math.min(submissions.length - 1, i + 1))}
                disabled={selectedStudentIdx >= submissions.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                Student {selectedStudentIdx + 1} of {submissions.length}
              </span>
              <span className="text-[10px] text-muted-foreground ml-2 hidden sm:inline">
                <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">J</kbd>/<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">K</kbd> navigate
              </span>
            </div>

            {currentSubmission && (
              <div className="flex items-center gap-3">
                <span className="font-medium">
                  {getStudentName(currentSubmission.studentId)}
                </span>
                <Badge
                  variant={currentSubmission.status === 'graded' ? 'default' : 'secondary'}
                >
                  {currentSubmission.status || 'unknown'}
                </Badge>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
              <Button onClick={handleSaveAndNext} disabled={saving}>
                {saving ? 'Saving...' : 'Save & Next'}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">⌘↵</kbd>
              </span>
              <button
                onClick={() => setShowShortcuts(prev => !prev)}
                className="ml-1 w-6 h-6 rounded bg-muted text-muted-foreground text-xs font-mono hover:text-foreground transition-colors"
                title="Keyboard shortcuts"
              >?</button>
            </div>
          </div>

          {/* Shortcuts overlay */}
          {showShortcuts && (
            <div className="border-b bg-muted/30 px-6 py-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span><kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">J</kbd> / <kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">K</kbd> Navigate students</span>
              <span><kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">Tab</kbd> Next field</span>
              <span><kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">⌘+Enter</kbd> Save & Next</span>
              <span><kbd className="px-1.5 py-0.5 bg-background border rounded text-[10px] font-mono">?</kbd> Toggle shortcuts</span>
            </div>
          )}

          {/* Responses */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loadingResponses ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : !currentSubmission ? (
              <div className="text-center py-16 text-muted-foreground">
                Select a student to begin grading
              </div>
            ) : (
              questions.map((q, idx) => {
                const response = responses.find((r) => r.questionId === q.id)
                const grade = response ? grades[response.id] || { pointsEarned: '', feedback: '' } : null

                return (
                  <div key={q.id} className="space-y-3">
                    {/* Question */}
                    <div className="border rounded-lg p-4 bg-muted/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">
                          Question {idx + 1}
                          <span className="text-muted-foreground font-normal ml-2">
                            ({q.points || 0} points)
                          </span>
                        </span>
                        <Badge variant="outline" className="text-xs">{q.type}</Badge>
                      </div>
                      <MathRenderer
                        content={q.content || q.questionText || ''}
                        className="text-sm"
                      />
                      {q.rubricCriteria && q.rubricCriteria.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Rubric Criteria:</p>
                          <ul className="text-xs text-muted-foreground space-y-1">
                            {q.rubricCriteria.map((criterion, ci) => (
                              <li key={ci} className="flex justify-between">
                                <span>{criterion.description || criterion.label}</span>
                                <span className="font-medium">{criterion.points} pts</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Student Answer */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Student Answer</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {response ? (
                          <div className="text-sm whitespace-pre-wrap">
                            {response.textAnswer || response.selectedAnswer || response.answer || (
                              <span className="text-muted-foreground italic">No answer provided</span>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">No response submitted</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Grading section */}
                    {response && grade && (
                      <Card>
                        <CardContent className="pt-4 space-y-3">
                          {/* Rubric criteria grading */}
                          {q.rubricCriteria && q.rubricCriteria.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Grade by Criteria:</p>
                              {q.rubricCriteria.map((criterion, ci) => (
                                <div key={ci} className="flex items-center gap-3 text-sm">
                                  <span className="flex-1 text-muted-foreground">
                                    {criterion.description || criterion.label}
                                  </span>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={criterion.points}
                                    placeholder={`/ ${criterion.points}`}
                                    className="w-20 h-7 text-sm"
                                  />
                                  <span className="text-xs text-muted-foreground w-12">
                                    / {criterion.points}
                                  </span>
                                </div>
                              ))}
                              <div className="pt-2 border-t flex items-center gap-2">
                                <label className="text-sm font-medium">Total Points:</label>
                                <Input
                                  type="number"
                                  min={0}
                                  max={q.points || 100}
                                  className="w-20 h-8"
                                  value={grade.pointsEarned}
                                  onChange={(e) =>
                                    setGrades((prev) => ({
                                      ...prev,
                                      [response.id]: { ...prev[response.id], pointsEarned: e.target.value },
                                    }))
                                  }
                                />
                                <span className="text-sm text-muted-foreground">/ {q.points || 0}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">Points:</label>
                              <Input
                                type="number"
                                min={0}
                                max={q.points || 100}
                                className="w-20 h-8"
                                value={grade.pointsEarned}
                                onChange={(e) =>
                                  setGrades((prev) => ({
                                    ...prev,
                                    [response.id]: { ...prev[response.id], pointsEarned: e.target.value },
                                  }))
                                }
                              />
                              <span className="text-sm text-muted-foreground">/ {q.points || 0}</span>
                            </div>
                          )}

                          {/* Feedback */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-medium">Feedback</label>
                              {grade.feedback && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs"
                                  onClick={() => handleCopyFeedback(grade.feedback)}
                                >
                                  <Copy className="h-3 w-3 mr-1" />
                                  Copy
                                </Button>
                              )}
                            </div>
                            <Textarea
                              placeholder="Provide feedback for this response..."
                              rows={3}
                              value={grade.feedback}
                              onChange={(e) =>
                                setGrades((prev) => ({
                                  ...prev,
                                  [response.id]: { ...prev[response.id], feedback: e.target.value },
                                }))
                              }
                            />
                            {/* Quick feedback presets */}
                            {feedbackPresets.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {feedbackPresets.map((preset, pi) => (
                                  <button
                                    key={pi}
                                    className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setGrades(prev => ({
                                      ...prev,
                                      [response.id]: { ...prev[response.id], feedback: (prev[response.id]?.feedback || '') + (prev[response.id]?.feedback ? ' ' : '') + preset },
                                    }))}
                                    title={`⌘+${pi + 1}`}
                                  >
                                    {preset}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default withAuth(GradingPage, ['teacher'])
