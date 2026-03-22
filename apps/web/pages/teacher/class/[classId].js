import { useEffect, useState, useRef, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc,
  deleteDoc, 
  orderBy,
  serverTimestamp 
} from 'firebase/firestore';

import { db, functions } from '@/firebase';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { getClassById } from '@/lib/classUtils';
import { uploadWithProgress, deleteFile } from '@/lib/storageUtils';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, ArrowLeft, Users, FileText, CheckCircle, Upload, Trash2, FileIcon, Award, Plus, MoreHorizontal, Pencil, ClipboardList } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Quiz form schema moved inside components for dynamic validation

function TeacherClassPage() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();
  
  const [classData, setClassData] = useState(null);
  const [enrolledStudents, setEnrolledStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Knowledge Base State
  const [kbDocs, setKbDocs] = useState([]);
  const [isKbLoading, setIsKbLoading] = useState(true);
  
  // Upload State
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Performance State
  const [performanceData, setPerformanceData] = useState({
    avgGrade: 0,
    avgQuiz: 0,
    topGaps: [],
    distribution: []
  });
  const [isPerformanceLoading, setIsPerformanceLoading] = useState(true);

  // Quiz State
  const [quizzes, setQuizzes] = useState([]);
  const [quizAttempts, setQuizAttempts] = useState([]);
  const [isQuizzesLoading, setIsQuizzesLoading] = useState(true);
  const [isQuizDialogOpen, setIsQuizDialogOpen] = useState(false);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState(null);
  const [deleteQuizTarget, setDeleteQuizTarget] = useState(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingQuiz, setIsDeletingQuiz] = useState(false);

  // Assignment State
  const [assignments, setAssignments] = useState([]);
  const [isAssignmentsLoading, setIsAssignmentsLoading] = useState(true);
  const [isAssignmentUploading, setIsAssignmentUploading] = useState(false);
  const [uploadAssignmentTitle, setUploadAssignmentTitle] = useState('');
  const [uploadAssignmentFile, setUploadAssignmentFile] = useState(null);
  const [uploadAssignmentError, setUploadAssignmentError] = useState(null);
  const [uploadAssignmentProgress, setUploadAssignmentProgress] = useState(0);
  const assignmentFileInputRef = useRef(null);

  // Quiz form schema with dynamic validation
  const quizFormSchema = useMemo(() => z.object({
    title: z.string().min(1, 'Title is required').max(100, 'Title must be under 100 characters'),
    description: z.string().min(1, 'Description is required').max(500, 'Description must be under 500 characters'),
    isActive: z.boolean().default(true),
    excludedDocIds: z.array(z.string()).default([]),
  }).refine((data) => data.excludedDocIds.length < kbDocs.length, {
    message: "At least one knowledge base document must be selected.",
    path: ["excludedDocIds"]
  }), [kbDocs.length]);

  // Quiz Form
  const quizForm = useForm({
    resolver: zodResolver(quizFormSchema),
    defaultValues: {
      title: '',
      description: '',
      isActive: true,
      excludedDocIds: [],
    },
  });

  const fetchKnowledgeBase = async () => {
    if (!classId) return;
    try {
      setIsKbLoading(true);
      const q = query(collection(db, 'knowledgeBase'), where('classId', '==', classId));
      const querySnapshot = await getDocs(q);
      const docs = [];
      querySnapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
      });
      // Sort by uploadedAt (client-side for simplicity since timestamp may be serverTimestamp)
      docs.sort((a, b) => {
        const timeA = a.uploadedAt?.toMillis() || 0;
        const timeB = b.uploadedAt?.toMillis() || 0;
        return timeB - timeA;
      });
      setKbDocs(docs);
    } catch (err) {
      console.error("Error fetching knowledge base:", err);
    } finally {
      setIsKbLoading(false);
    }
  };

  const fetchQuizzes = async () => {
    if (!classId) return;
    try {
      setIsQuizzesLoading(true);
      const q = query(
        collection(db, 'quizzes'),
        where('classId', '==', classId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const quizList = [];
      querySnapshot.forEach((docSnap) => {
        quizList.push({ id: docSnap.id, ...docSnap.data() });
      });
      setQuizzes(quizList);
    } catch (err) {
      console.error("Error fetching quizzes:", err);
    } finally {
      setIsQuizzesLoading(false);
    }
  };

  const fetchAssignments = async () => {
    if (!classId) return;
    try {
      setIsAssignmentsLoading(true);
      const q = query(
        collection(db, 'assignments'),
        where('classId', '==', classId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const list = [];
      querySnapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setAssignments(list);
    } catch (err) {
      console.error("Error fetching assignments:", err);
    } finally {
      setIsAssignmentsLoading(false);
    }
  };

  useEffect(() => {
    async function loadClassAndStudents() {
      if (!classId || !user) return;
      
      try {
        setIsLoading(true);
        // 1. Fetch class
        const fetchedClass = await getClassById(classId);
        
        if (!fetchedClass) {
          setError("Class not found.");
          setIsLoading(false);
          return;
        }

        // 2. Verify ownership
        if (fetchedClass.teacherId !== user.uid) {
          setError("You do not have permission to view this class.");
          setIsLoading(false);
          return;
        }

        setClassData(fetchedClass);

        // 3. Fetch student details based on studentIds array
        if (fetchedClass.studentIds && fetchedClass.studentIds.length > 0) {
          const studentsPromises = fetchedClass.studentIds.map(async (uid) => {
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
              return { uid: userDoc.id, ...userDoc.data() };
            }
            return { uid, displayName: 'Unknown Student', email: 'N/A' };
          });
          
          const studentsObj = await Promise.all(studentsPromises);
          
          // 4. Fetch Performance Data
          try {
            setIsPerformanceLoading(true);
            const gradingJobsQuery = query(
              collection(db, 'gradingJobs'), 
              where('classId', '==', classId),
              where('teacherId', '==', user.uid)
            );
            const quizQuery = query(collection(db, 'quizAttempts'), where('classId', '==', classId));
            
            const [jobsSnapshot, quizSnapshot] = await Promise.all([
              getDocs(gradingJobsQuery),
              getDocs(quizQuery)
            ]);

            const jobs = jobsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const quizAttempts = quizSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            setQuizAttempts(quizAttempts);

            // Calculate Aggregates
            const completedJobs = jobs.filter(j => j.score !== null);
            const avgGrade = completedJobs.length > 0 
              ? completedJobs.reduce((sum, j) => sum + j.score, 0) / completedJobs.length 
              : 0;

            const avgQuiz = quizAttempts.length > 0 
              ? quizAttempts.reduce((sum, q) => sum + q.score, 0) / quizAttempts.length 
              : 0;

            const gapCounts = {};
            quizAttempts.forEach(q => {
              if (q.topicGaps) {
                q.topicGaps.forEach(topic => {
                  gapCounts[topic] = (gapCounts[topic] || 0) + 1;
                });
              }
            });
            const topGaps = Object.entries(gapCounts)
              .map(([topic, count]) => ({ topic, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5);

            const distributionGroups = [
              { range: '0-59', count: 0 },
              { range: '60-69', count: 0 },
              { range: '70-79', count: 0 },
              { range: '80-89', count: 0 },
              { range: '90-100', count: 0 }
            ];
            completedJobs.forEach(j => {
              const score = j.score;
              if (score < 60) distributionGroups[0].count++;
              else if (score < 70) distributionGroups[1].count++;
              else if (score < 80) distributionGroups[2].count++;
              else if (score < 90) distributionGroups[3].count++;
              else distributionGroups[4].count++;
            });

            setPerformanceData({
              avgGrade: Math.round(avgGrade),
              avgQuiz: Math.round(avgQuiz),
              topGaps,
              distribution: distributionGroups
            });

            // Update enrolled students with latest scores
            const updatedStudents = studentsObj.map(student => {
              const studentJobs = jobs.filter(j => j.studentId === student.uid && j.score !== null);
              const studentQuizzes = quizAttempts.filter(q => q.studentId === student.uid);

              studentJobs.sort((a, b) => (b.completedAt?.toMillis() || 0) - (a.completedAt?.toMillis() || 0));
              studentQuizzes.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

              return {
                ...student,
                latestGrade: studentJobs[0]?.score ?? null,
                latestQuiz: studentQuizzes[0]?.score ?? null
              };
            });
            setEnrolledStudents(updatedStudents);
          } catch (perfErr) {
            console.error("Error fetching performance metrics:", perfErr);
            setEnrolledStudents(studentsObj);
          } finally {
            setIsPerformanceLoading(false);
          }
        } else {
          setEnrolledStudents([]);
          setIsPerformanceLoading(false);
        }

        // 5. Fetch Knowledge Base
        fetchKnowledgeBase();

        // 6. Fetch Quizzes
        fetchQuizzes();

        // 7. Fetch Assignments
        fetchAssignments();

      } catch (err) {
        console.error("Error fetching class details:", err);
        setError("Failed to load class data.");
      } finally {
        setIsLoading(false);
      }
    }

    loadClassAndStudents();
  }, [classId, user]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setUploadFile(file);
      setUploadError(null);
    } else if (file) {
      setUploadFile(null);
      setUploadError("Only PDF files are supported.");
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError("Please select a PDF file first.");
      return;
    }
    if (!uploadTitle.trim()) {
      setUploadError("Please provide a title for the document.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    try {
      // Force token refresh to pick up Custom Claims (role: 'teacher')
      if (user) {
        await user.getIdToken(true);
      }

      // Create a document ref first to get an ID

      const newDocRef = doc(collection(db, 'knowledgeBase'));
      const docId = newDocRef.id;

      // Ensure classId exists in path exactly matching the structure rules expects:
      // /knowledgeBase/{classId}/{docId}.pdf
      const storagePath = `knowledgeBase/${classId}/${docId}.pdf`;

      const downloadURL = await uploadWithProgress(storagePath, uploadFile, (progress) => {
        setUploadProgress(progress);
      });

      // Write to Firestore using the generated docId
      await addDoc(collection(db, 'knowledgeBase'), {
        docId: docId,
        classId: classId,
        teacherId: user.uid,
        title: uploadTitle.trim(),
        storageUrl: storagePath, // Using the path as requested, not the downloadURL
        uploadedAt: serverTimestamp()
      });

      // Reset form
      setUploadTitle('');
      setUploadFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Refresh list
      fetchKnowledgeBase();
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadError("Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDoc = async (docId, storagePath) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    
    try {
      // Delete from storage
      await deleteFile(storagePath);
      
      // Delete from Firestore
      await deleteDoc(doc(db, 'knowledgeBase', docId));
      
      // Refresh list
      fetchKnowledgeBase();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete document.");
    }
  };

  const handleAssignmentFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setUploadAssignmentFile(file);
      setUploadAssignmentError(null);
    } else if (file) {
      setUploadAssignmentFile(null);
      setUploadAssignmentError("Only PDF files are supported.");
    }
  };

  const handleAssignmentUpload = async () => {
    if (!uploadAssignmentFile) {
      setUploadAssignmentError("Please select a PDF file first.");
      return;
    }
    if (!uploadAssignmentTitle.trim()) {
      setUploadAssignmentError("Please provide a title.");
      return;
    }

    setIsAssignmentUploading(true);
    setUploadAssignmentError(null);
    setUploadAssignmentProgress(0);

    try {
      // 1. Upload file to Storage
      const docId = doc(collection(db, 'assignments')).id;
      const storagePath = `assignments/${classId}/${docId}.pdf`;

      const downloadURL = await uploadWithProgress(storagePath, uploadAssignmentFile, (progress) => {
        setUploadAssignmentProgress(progress * 0.8); // 80% weight to upload
      });

      // 2. Call generate_rubric
      setUploadAssignmentProgress(85);
      const generateRubricFn = httpsCallable(functions, 'generate_rubric');
      const result = await generateRubricFn({
        classId: classId,
        rawPdfPath: storagePath
      });

      const rubricData = result.data;

      setUploadAssignmentProgress(95);

      // 3. Save Assignment doc
      await addDoc(collection(db, 'assignments'), {
        classId: classId,
        teacherId: user.uid,
        title: uploadAssignmentTitle.trim(),
        pdfUrl: storagePath,
        rubric: rubricData,
        totalPoints: rubricData.totalPoints || 0,
        topic: rubricData.topic || '',
        createdAt: serverTimestamp()
      });

      // Reset form
      setUploadAssignmentTitle('');
      setUploadAssignmentFile(null);
      setUploadAssignmentProgress(0);
      if (assignmentFileInputRef.current) {
        assignmentFileInputRef.current.value = "";
      }

      // Refresh list
      fetchAssignments();
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadAssignmentError("Upload failed. AI might have failed to read the PDF or rate limit was hit.");
    } finally {
      setIsAssignmentUploading(false);
    }
  };

  // --- Quiz CRUD Handlers ---

  const openNewQuizDialog = () => {
    setEditingQuiz(null);
    quizForm.reset({ title: '', description: '', isActive: true, excludedDocIds: [] });
    setIsQuizDialogOpen(true);
  };

  const openEditQuizDialog = (quiz) => {
    setEditingQuiz(quiz);
    quizForm.reset({
      title: quiz.title,
      description: quiz.description,
      isActive: quiz.isActive ?? true,
      excludedDocIds: quiz.excludedDocIds || []
    });
    setIsQuizDialogOpen(true);
  };

  const onQuizSubmit = async (values) => {
    setIsQuizSubmitting(true);
    try {
      if (editingQuiz) {
        // Update existing quiz
        await updateDoc(doc(db, 'quizzes', editingQuiz.id), {
          title: values.title,
          description: values.description,
          isActive: values.isActive,
          excludedDocIds: values.excludedDocIds,
        });
      } else {
        // Create new quiz
        await addDoc(collection(db, 'quizzes'), {
          classId,
          teacherId: user.uid,
          title: values.title,
          description: values.description,
          isActive: values.isActive,
          excludedDocIds: values.excludedDocIds,
          createdAt: serverTimestamp(),
        });
      }
      setIsQuizDialogOpen(false);
      quizForm.reset();
      fetchQuizzes();
    } catch (err) {
      console.error("Quiz save failed:", err);
    } finally {
      setIsQuizSubmitting(false);
    }
  };

  const confirmDeleteQuiz = (quiz) => {
    setDeleteQuizTarget(quiz);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteQuiz = async () => {
    if (!deleteQuizTarget) return;
    setIsDeletingQuiz(true);
    try {
      await deleteDoc(doc(db, 'quizzes', deleteQuizTarget.id));
      setIsDeleteDialogOpen(false);
      setDeleteQuizTarget(null);
      fetchQuizzes();
    } catch (err) {
      console.error("Quiz delete failed:", err);
    } finally {
      setIsDeletingQuiz(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => router.push('/teacher/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
        </Button>
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{classData.name} - Teacher Dashboard</title>
      </Head>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Button variant="ghost" className="mb-4 -ml-4 text-muted-foreground" onClick={() => router.push('/teacher/dashboard')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {classData.name}
              </h1>
              <p className="text-muted-foreground mt-1 flex items-center">
                Class Code: <span className="font-mono ml-2 font-semibold text-foreground px-2 py-0.5 bg-muted rounded-md">{classData.classCode}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Roster & Performance Section */}
          <div className="lg:col-span-1 space-y-6">
            {/* Roster */}
            <Card className="border-muted/60">
              <CardHeader>
                <CardTitle className="flex items-center text-lg">
                  <Users className="w-5 h-5 mr-2 text-primary" />
                  Roster
                </CardTitle>
                <CardDescription>
                  {enrolledStudents.length} {enrolledStudents.length === 1 ? 'student' : 'students'} enrolled
                </CardDescription>
              </CardHeader>
              <CardContent>
                {enrolledStudents.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No students have joined yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Share code: <b className="text-foreground">{classData.classCode}</b></p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {enrolledStudents.map((student) => (
                      <li 
                        key={student.uid} 
                        className="flex flex-col p-3 bg-muted/40 hover:bg-muted/60 rounded-lg cursor-pointer transition-colors"
                        onClick={() => router.push(`/teacher/class/${classId}/student/${student.uid}`)}
                      >
                        <div className="flex justify-between items-start w-full">
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-foreground truncate block">{student.displayName}</span>
                            <span className="text-xs text-muted-foreground truncate block">{student.email}</span>
                          </div>
                          <div className="flex flex-col items-end text-xs shrink-0 ml-2">
                            <span className="text-muted-foreground flex items-center">
                              Grade: <b className="text-foreground ml-1">{student.latestGrade !== null ? `${student.latestGrade}%` : 'N/A'}</b>
                            </span>
                            <span className="text-muted-foreground flex items-center">
                              Quiz: <b className="text-foreground ml-1">{student.latestQuiz !== null ? `${student.latestQuiz}%` : 'N/A'}</b>
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Class Performance Metrics */}
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-lg">
                  <Award className="w-5 h-5 mr-2 text-primary" />
                  Class Performance
                </CardTitle>
                <CardDescription>
                  Overall aggregate stats for this class.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isPerformanceLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-muted/30 rounded-lg text-center">
                        <p className="text-xs text-muted-foreground">Avg Grade</p>
                        <p className="text-xl font-semibold text-foreground mt-1">
                          {performanceData.avgGrade}%
                        </p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg text-center">
                        <p className="text-xs text-muted-foreground">Avg Quiz</p>
                        <p className="text-xl font-semibold text-foreground mt-1">
                          {performanceData.avgQuiz}%
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground">Score Distribution</h4>
                      <div className="h-[120px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={performanceData.distribution} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                            <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={{ fontSize: '10px', padding: '4px' }} />
                            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground">Top Topic Gaps</h4>
                      {performanceData.topGaps.length === 0 ? (
                        <p className="text-center py-4 text-xs text-muted-foreground">No topic gaps recorded.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {performanceData.topGaps.map((gap, index) => (
                            <div key={gap.topic} className="flex items-center justify-between p-2 bg-muted/30 rounded-md text-xs">
                              <span className="font-medium text-foreground max-w-[150px] truncate">
                                {index + 1}. {gap.topic}
                              </span>
                              <span className="text-muted-foreground font-semibold px-1.5 py-0.5 bg-muted rounded">
                                {gap.count} {gap.count === 1 ? 'flag' : 'flags'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Knowledge Base Section */}
            <Card id="knowledge-base">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center text-lg">
                  <FileText className="w-5 h-5 mr-2 text-primary" />
                  Knowledge Base
                </CardTitle>
                <CardDescription>
                  Upload PDF reference materials for the AI Grading Engine to use as context when grading submissions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* Upload Form */}
                <div className="bg-muted/30 border rounded-xl p-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="docTitle">Document Title</Label>
                      <Input 
                        id="docTitle" 
                        placeholder="e.g., Chapter 4 Reading" 
                        value={uploadTitle}
                        onChange={(e) => setUploadTitle(e.target.value)}
                        disabled={isUploading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="docFile">PDF File</Label>
                      <Input 
                        id="docFile" 
                        type="file" 
                        accept=".pdf" 
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        disabled={isUploading}
                        className="cursor-pointer file:cursor-pointer file:text-foreground file:font-medium file:border-0 file:bg-transparent file:mr-4"
                      />
                    </div>
                  </div>
                  
                  {uploadError && (
                    <Alert variant="destructive" className="py-2 px-3">
                      <AlertDescription className="text-xs">{uploadError}</AlertDescription>
                    </Alert>
                  )}

                  {isUploading && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Uploading...</span>
                        <span>{Math.round(uploadProgress)}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2" />
                    </div>
                  )}

                  <Button 
                    onClick={handleUpload} 
                    disabled={isUploading || !uploadFile || !uploadTitle.trim()} 
                    className="w-full sm:w-auto mt-2"
                  >
                    {isUploading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading</>
                    ) : (
                      <><Upload className="w-4 h-4 mr-2" /> Upload to Knowledge Base</>
                    )}
                  </Button>
                </div>

                {/* Document List */}
                <div className="pt-2">
                  <h3 className="text-sm font-medium mb-3">Uploaded Documents</h3>
                  
                  {isKbLoading ? (
                    <div className="space-y-3">
                      <div className="h-12 bg-muted/50 rounded-lg animate-pulse"></div>
                      <div className="h-12 bg-muted/50 rounded-lg animate-pulse"></div>
                    </div>
                  ) : kbDocs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-lg bg-muted/20">
                      <FileIcon className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                      <p className="text-sm font-medium text-foreground">No documents uploaded</p>
                      <p className="text-xs text-muted-foreground max-w-[250px] mt-1">
                        Files you upload here will be referenced by the AI during grading.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {kbDocs.map((doc) => (
                        <li key={doc.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/10 transition-colors">
                          <div className="flex items-center space-x-3 overflow-hidden">
                            <div className="bg-primary/10 p-2 rounded-md shrink-0">
                              <FileText className="w-4 h-4 text-primary" />
                            </div>
                            <div className="truncate">
                              <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {doc.uploadedAt ? new Date(doc.uploadedAt.toMillis()).toLocaleDateString() : 'Just now'}
                              </p>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-muted-foreground hover:text-destructive shrink-0 ml-2"
                            onClick={() => handleDeleteDoc(doc.id, doc.storageUrl)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

              </CardContent>
            </Card>

            {/* Quizzes Section */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center text-lg">
                      <ClipboardList className="w-5 h-5 mr-2 text-primary" />
                      Quizzes
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Create and manage quizzes for your students.
                    </CardDescription>
                  </div>
                  <Button onClick={openNewQuizDialog}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Quiz
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isQuizzesLoading ? (
                  <div className="space-y-3">
                    <div className="h-12 bg-muted/50 rounded-lg animate-pulse"></div>
                    <div className="h-12 bg-muted/50 rounded-lg animate-pulse"></div>
                  </div>
                ) : quizzes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-lg bg-muted/20">
                    <ClipboardList className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="text-sm font-medium">No quizzes yet</p>
                    <p className="text-sm text-muted-foreground">
                      Create a quiz to make it available to your students.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Sources</TableHead>
                        <TableHead className="w-[140px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quizzes.map((quiz) => (
                        <TableRow key={quiz.id}>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{quiz.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1">{quiz.description}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={quiz.isActive ? 'default' : 'secondary'}>
                              {quiz.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {quiz.createdAt
                              ? new Date(quiz.createdAt.toMillis()).toLocaleDateString()
                              : 'Just now'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {quizAttempts.filter(qa => qa.quizId === quiz.id).length}
                          </TableCell>
                          <TableCell className="text-sm">
                            {kbDocs.length - (quiz.excludedDocIds?.length || 0)} / {kbDocs.length}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 text-xs px-2"
                                onClick={() => router.push(`/teacher/class/${classId}/quiz/${quiz.id}`)}
                              >
                                View Results
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                    <span className="sr-only">Actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openEditQuizDialog(quiz)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => confirmDeleteQuiz(quiz)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Assignments Section */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center text-lg">
                      <FileText className="w-5 h-5 mr-2 text-primary" />
                      Assignments
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Upload reading assignments or homework sheets for AI assisted grading.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* Upload Form */}
                <div className="bg-muted/30 border rounded-xl p-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="asTitle">Assignment Title</Label>
                      <Input 
                        id="asTitle" 
                        placeholder="Homework 1: Newton's Laws" 
                        value={uploadAssignmentTitle}
                        onChange={(e) => setUploadAssignmentTitle(e.target.value)}
                        disabled={isAssignmentUploading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="asFile">Homework PDF</Label>
                      <Input 
                        id="asFile" 
                        type="file" 
                        accept=".pdf" 
                        ref={assignmentFileInputRef}
                        onChange={handleAssignmentFileChange}
                        disabled={isAssignmentUploading}
                        className="cursor-pointer file:cursor-pointer file:text-foreground file:font-medium file:border-0 file:bg-transparent file:mr-4"
                      />
                    </div>
                  </div>
                  
                  {uploadAssignmentError && (
                    <Alert variant="destructive" className="py-2 px-3">
                      <AlertDescription className="text-xs">{uploadAssignmentError}</AlertDescription>
                    </Alert>
                  )}

                  {isAssignmentUploading && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{uploadAssignmentProgress < 85 ? 'Uploading...' : 'Analyzing with AI...'}</span>
                        <span>{Math.round(uploadAssignmentProgress)}%</span>
                      </div>
                      <Progress value={uploadAssignmentProgress} className="h-2" />
                    </div>
                  )}

                  <Button 
                    onClick={handleAssignmentUpload} 
                    disabled={isAssignmentUploading || !uploadAssignmentFile || !uploadAssignmentTitle.trim()} 
                    className="w-full sm:w-auto mt-2"
                  >
                    {isAssignmentUploading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Rubric</>
                    ) : (
                      <><Upload className="w-4 h-4 mr-2" /> Create Assignment</>
                    )}
                  </Button>
                </div>

                {/* Assignment List */}
                <div className="pt-2">
                  <h4 className="text-sm font-medium mb-3">Active Assignments</h4>
                  {isAssignmentsLoading ? (
                    <div className="space-y-3">
                      <div className="h-12 bg-muted/50 rounded-lg animate-pulse"></div>
                    </div>
                  ) : assignments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-lg bg-muted/20">
                      <FileIcon className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                      <p className="text-sm font-medium">No assignments created</p>
                      <p className="text-xs text-muted-foreground max-w-[250px] mt-1">
                        Create an assignment to verify rubric generation templates.
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Topic</TableHead>
                          <TableHead>Points</TableHead>
                          <TableHead>Questions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.map((assignment) => (
                          <TableRow 
                            key={assignment.id} 
                            className="cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() => router.push(`/teacher/homework/${assignment.id}`)}
                          >
                            <TableCell className="font-medium">{assignment.title}</TableCell>
                            <TableCell className="text-xs">{assignment.topic || 'N/A'}</TableCell>
                            <TableCell>{assignment.totalPoints || 0}</TableCell>
                            <TableCell>{assignment.rubric?.questions?.length || 0}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

              </CardContent>
            </Card>

          </div>
        </div>
      </div>

      {/* Quiz Create/Edit Dialog */}
      <Dialog open={isQuizDialogOpen} onOpenChange={setIsQuizDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingQuiz ? 'Edit Quiz' : 'Create New Quiz'}</DialogTitle>
            <DialogDescription>
              {editingQuiz
                ? 'Update the quiz details below.'
                : 'Fill in the details to create a new quiz for your students.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...quizForm}>
            <form onSubmit={quizForm.handleSubmit(onQuizSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Panel: Quiz Details */}
                <div className="space-y-4">
                  <FormField
                    control={quizForm.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Midterm Practice" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={quizForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Review limits and derivatives..."
                            className="min-h-[80px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={quizForm.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <FormLabel>Active</FormLabel>
                          <FormDescription>
                            Make this quiz visible to students
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {/* Right Panel: Sources */}
                <div className="space-y-4">
                  <Label className="text-sm font-medium">Sources for this Quiz</Label>
                  {kbDocs.length === 0 ? (
                    <Alert variant="destructive">
                      <AlertDescription className="text-xs">
                        No documents uploaded — upload at least one knowledge base document before creating a quiz.
                        <br />
                        <a href="#knowledge-base" className="underline mt-1 inline-block" onClick={() => setIsQuizDialogOpen(false)}>
                          Go to Knowledge Base ↑
                        </a>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <div className="border rounded-lg p-2 max-h-[240px] overflow-y-auto space-y-1">
                        {kbDocs.map((doc) => {
                          const isChecked = !quizForm.watch('excludedDocIds')?.includes(doc.id);
                          const totalChecked = kbDocs.length - (quizForm.watch('excludedDocIds')?.length || 0);
                          const isDisabled = isChecked && totalChecked === 1;

                          return (
                            <div key={doc.id} className={cn("flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50 transition-colors", !isChecked && "opacity-60")}>
                              <input 
                                type="checkbox"
                                id={`doc-${doc.id}`}
                                checked={isChecked}
                                disabled={isDisabled}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  const excluded = quizForm.getValues('excludedDocIds') || [];
                                  if (checked) {
                                    quizForm.setValue('excludedDocIds', excluded.filter(id => id !== doc.id));
                                  } else {
                                    quizForm.setValue('excludedDocIds', [...excluded, doc.id]);
                                  }
                                }}
                                className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                              />
                              <label htmlFor={`doc-${doc.id}`} className="flex items-center space-x-2 cursor-pointer flex-1">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                <div className="truncate">
                                  <span className="text-sm font-medium truncate inline-block max-w-[150px]">{doc.title}</span>
                                  <span className="text-xs text-muted-foreground block">
                                    {doc.uploadedAt ? new Date(doc.uploadedAt.toMillis()).toLocaleDateString() : 'Just now'}
                                  </span>
                                </div>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {kbDocs.length - (quizForm.watch('excludedDocIds')?.length || 0)} of {kbDocs.length} document(s) will be used
                      </div>
                      {quizForm.watch('excludedDocIds')?.length === kbDocs.length && (
                        <Alert variant="destructive" className="py-2 px-3">
                          <AlertDescription className="text-xs">All documents are excluded. At least one document must be selected.</AlertDescription>
                        </Alert>
                      )}
                      <FormField
                        control={quizForm.control}
                        name="excludedDocIds"
                        render={() => (
                          <FormMessage className="text-xs" />
                        )}
                      />
                    </>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsQuizDialogOpen(false)}
                  disabled={isQuizSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isQuizSubmitting || kbDocs.length === 0 || (quizForm.watch('excludedDocIds')?.length === kbDocs.length)}
                >
                  {isQuizSubmitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {editingQuiz ? 'Saving...' : 'Creating...'}</>
                  ) : editingQuiz ? (
                    'Save Changes'
                  ) : (
                    'Create Quiz'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quiz</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteQuizTarget?.title}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeletingQuiz}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteQuiz}
              disabled={isDeletingQuiz}
            >
              {isDeletingQuiz ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting</>
              ) : (
                'Delete Quiz'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Wrap with teacher auth guard
export default withAuth(TeacherClassPage, 'teacher');
