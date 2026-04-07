import { useEffect, useState, useRef, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
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
  serverTimestamp,
  arrayUnion,
  arrayRemove
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, ArrowLeft, Users, FileText, CheckCircle, Upload, Trash2, FileIcon, Award, Plus, MoreHorizontal, Pencil, ClipboardList, Flame, AlertTriangle, TrendingDown, Megaphone, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const RichMathEditor = dynamic(() => import('@/components/editor/RichMathEditor'), { ssr: false });

// Quiz form schema moved inside components for dynamic validation

function TeacherClassPage() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  // Don't render until router params are available (required for static export)
  if (!router.isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [classData, setClassData] = useState(null);
  const [isClassOwner, setIsClassOwner] = useState(true);
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
  const [uploadIsSyllabus, setUploadIsSyllabus] = useState(false);
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
  const [uploadAssignmentDueDate, setUploadAssignmentDueDate] = useState('');
  const [uploadAssignmentFile, setUploadAssignmentFile] = useState(null);
  const [uploadAssignmentError, setUploadAssignmentError] = useState(null);
  const [uploadAssignmentProgress, setUploadAssignmentProgress] = useState(0);
  const [uploadSubmissionType, setUploadSubmissionType] = useState('pdf'); // 'pdf' | 'text' | 'both'
  const assignmentFileInputRef = useRef(null);

  // Confusion Heatmap State
  const [heatmapData, setHeatmapData] = useState(null);
  const [isHeatmapLoading, setIsHeatmapLoading] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Archived Students State
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [reinviteConfirmId, setReinviteConfirmId] = useState(null);
  const [deleteStudentConfirmId, setDeleteStudentConfirmId] = useState(null);

  // Edit Assignment State
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [isAssignmentSubmitting, setIsAssignmentSubmitting] = useState(false);

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

  const assignmentFormSchema = z.object({
    title: z.string().min(1, 'Title is required').max(100, 'Title must be under 100 characters'),
    dueDate: z.string().optional(),
    questionPoints: z.array(z.object({
      number: z.string(),
      points: z.coerce.number().min(0, 'Must be 0 or more'),
    })).optional(),
  });

  const assignmentForm = useForm({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: { title: '', dueDate: '', questionPoints: [] }
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
      const isOwner = classData?.teacherId === user.uid;
      const q = isOwner
        ? query(collection(db, 'quizzes'), where('classId', '==', classId), where('teacherId', '==', user.uid), orderBy('createdAt', 'desc'))
        : query(collection(db, 'quizzes'), where('classId', '==', classId), orderBy('createdAt', 'desc'));
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
      const isOwner = classData?.teacherId === user.uid;
      const q = isOwner
        ? query(collection(db, 'assignments'), where('classId', '==', classId), where('teacherId', '==', user.uid), orderBy('createdAt', 'desc'))
        : query(collection(db, 'assignments'), where('classId', '==', classId), orderBy('createdAt', 'desc'));
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

        // 2. Verify ownership or TA access
        const isOwner = fetchedClass.teacherId === user.uid;
        const isTA = (fetchedClass.taIds || []).includes(user.uid);
        if (!isOwner && !isTA) {
          setError("You do not have permission to view this class.");
          setIsLoading(false);
          return;
        }

        setIsClassOwner(isOwner);
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
            const gradingJobsQuery = isOwner
              ? query(collection(db, 'gradingJobs'), where('classId', '==', classId), where('teacherId', '==', user.uid))
              : query(collection(db, 'gradingJobs'), where('classId', '==', classId));
            const quizQuery = isOwner
              ? query(collection(db, 'quizAttempts'), where('classId', '==', classId), where('teacherId', '==', user.uid))
              : query(collection(db, 'quizAttempts'), where('classId', '==', classId));
            
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

        // 5. Fetch Archived Students
        if (fetchedClass.archivedStudents && fetchedClass.archivedStudents.length > 0) {
          const archivedPromises = fetchedClass.archivedStudents.map(async (uid) => {
            try {
              const userDoc = await getDoc(doc(db, 'users', uid));
              if (userDoc.exists()) {
                return { uid: userDoc.id, ...userDoc.data() };
              }
            } catch (err) {
              console.error(`Error fetching archived user ${uid}:`, err);
            }
            return { uid, displayName: 'Unknown Student', email: 'N/A' };
          });
          const archivedObj = await Promise.all(archivedPromises);
          setArchivedStudents(archivedObj);
        } else {
          setArchivedStudents([]);
        }

        // 6. Fetch Knowledge Base
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
        storageUrl: storagePath,
        isSyllabus: uploadIsSyllabus,
        uploadedAt: serverTimestamp()
      });

      // Reset form
      setUploadTitle('');
      setUploadFile(null);
      setUploadProgress(0);
      setUploadIsSyllabus(false);
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
        submissionType: uploadSubmissionType,
        dueDate: uploadAssignmentDueDate ? new Date(uploadAssignmentDueDate) : null,
        createdAt: serverTimestamp()
      });

      // Reset form
      setUploadAssignmentTitle('');
      setUploadAssignmentDueDate('');
      setUploadAssignmentFile(null);
      setUploadAssignmentProgress(0);
      setUploadSubmissionType('pdf');
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

  // Announcement State
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');
  const [isSendingAnnouncement, setIsSendingAnnouncement] = useState(false);

  const handleSendAnnouncement = async () => {
    if (!announcementText.trim() || !classData) return;
    setIsSendingAnnouncement(true);
    try {
      const studentIds = classData.studentIds || [];
      const batch = [];
      for (const studentId of studentIds) {
        batch.push(
          addDoc(collection(db, 'notifications'), {
            senderId: user.uid,
            recipientId: studentId,
            notifType: 'announcement',
            title: `Announcement: ${classData.name}`,
            message: announcementText.trim(),
            href: `/student/class/${classId}`,
            read: false,
            createdAt: serverTimestamp(),
          })
        );
      }
      await Promise.all(batch);
      setAnnouncementText('');
      setIsAnnouncementOpen(false);
    } catch (err) {
      console.error('Error sending announcement:', err);
    } finally {
      setIsSendingAnnouncement(false);
    }
  };

  // --- TA Management Handler ---
  const handleToggleTA = async (studentUid) => {
    const taIds = classData?.taIds || [];
    const isTA = taIds.includes(studentUid);
    const newTaIds = isTA ? taIds.filter(id => id !== studentUid) : [...taIds, studentUid];
    try {
      await updateDoc(doc(db, 'classes', classId), { taIds: newTaIds });
      setClassData(prev => ({ ...prev, taIds: newTaIds }));
    } catch (err) {
      console.error('Error toggling TA:', err);
    }
  };

  // --- Delete Assignment Handler ---
  const [deleteAssignmentId, setDeleteAssignmentId] = useState(null);

  const handleDeleteAssignment = async (assignment) => {
    try {
      // Delete PDF from storage if exists
      if (assignment.pdfUrl) {
        await deleteFile(assignment.pdfUrl).catch(() => {});
      }
      // Delete assignment doc
      await deleteDoc(doc(db, 'assignments', assignment.id));
      fetchAssignments();
      setDeleteAssignmentId(null);
    } catch (err) {
      console.error('Error deleting assignment:', err);
    }
  };

  // --- Confusion Heatmap Handler ---
  const generateHeatmap = async () => {
    setIsHeatmapLoading(true);
    setShowHeatmap(true);
    try {
      const fn = httpsCallable(functions, 'confusion_heatmap');
      const result = await fn({ classId });
      setHeatmapData(result.data);
    } catch (err) {
      console.error('Heatmap generation error:', err);
      setHeatmapData({
        analysis: 'Failed to generate analysis. Please try again.',
        topics: []
      });
    } finally {
      setIsHeatmapLoading(false);
    }
  };

  // --- Archived Student Handlers ---
  const handleReinviteStudent = async (studentUid) => {
    try {
      await updateDoc(doc(db, 'classes', classId), {
        archivedStudents: arrayRemove(studentUid),
        studentIds: arrayUnion(studentUid),
      });
      const student = archivedStudents.find(s => s.uid === studentUid);
      if (student) {
        setArchivedStudents(prev => prev.filter(s => s.uid !== studentUid));
        setEnrolledStudents(prev => [...prev, student]);
      }
      setReinviteConfirmId(null);
    } catch (err) {
      console.error('Error reinviting student:', err);
    }
  };

  const handleDeleteArchivedStudent = async (studentUid) => {
    try {
      await updateDoc(doc(db, 'classes', classId), {
        archivedStudents: arrayRemove(studentUid),
      });
      setArchivedStudents(prev => prev.filter(s => s.uid !== studentUid));
      setDeleteStudentConfirmId(null);
    } catch (err) {
      console.error('Error removing archived student:', err);
    }
  };

  const openEditAssignmentDialog = (e, asgn) => {
    e.stopPropagation();
    setEditingAssignment(asgn);
    let dateStr = '';
    if (asgn.dueDate) {
      const d = asgn.dueDate?.toDate ? asgn.dueDate.toDate() : new Date(asgn.dueDate);
      // Format as YYYY-MM-DD
      const offset = d.getTimezoneOffset();
      const localDate = new Date(d.getTime() - (offset*60*1000));
      dateStr = localDate.toISOString().split('T')[0];
    }
    const qPoints = (asgn.rubric?.questions || []).map(q => ({
      number: q.number || '',
      points: q.points ?? 1,
    }));
    assignmentForm.reset({
      title: asgn.title,
      dueDate: dateStr,
      questionPoints: qPoints,
    });
    setIsAssignmentDialogOpen(true);
  };

  const onAssignmentSubmit = async (values) => {
    setIsAssignmentSubmitting(true);
    try {
      let dd = null;
      if (values.dueDate) {
        const parts = values.dueDate.split('-');
        dd = new Date(parts[0], parts[1] - 1, parts[2]);
      }

      const updateData = {
        title: values.title,
        dueDate: dd
      };

      // Update rubric question points if provided
      if (values.questionPoints?.length > 0 && editingAssignment.rubric?.questions) {
        const updatedQuestions = editingAssignment.rubric.questions.map((q, idx) => {
          const override = values.questionPoints[idx];
          return override ? { ...q, points: override.points } : q;
        });
        const newTotal = updatedQuestions.reduce((sum, q) => sum + (q.points || 0), 0);
        updateData.rubric = { ...editingAssignment.rubric, questions: updatedQuestions, totalPoints: newTotal };
        updateData.totalPoints = newTotal;
      }

      await updateDoc(doc(db, 'assignments', editingAssignment.id), updateData);

      setIsAssignmentDialogOpen(false);
      assignmentForm.reset();
      fetchAssignments();
    } catch (err) {
      console.error("Assignment save failed:", err);
    } finally {
      setIsAssignmentSubmitting(false);
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
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">Extension Passes per Student:</span>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  className="w-16 h-7 text-center text-sm rounded-lg"
                  value={classData.extensionPassesTotal ?? 0}
                  onChange={async (e) => {
                    const val = Math.max(0, Math.min(10, parseInt(e.target.value) || 0));
                    try {
                      await updateDoc(doc(db, 'classes', classId), { extensionPassesTotal: val });
                      setClassData(prev => ({ ...prev, extensionPassesTotal: val }));
                    } catch (err) {
                      console.error('Error updating extension passes:', err);
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isClassOwner && (
              <Button
                className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                onClick={() => setIsAnnouncementOpen(true)}
              >
                <Megaphone className="h-4 w-4 mr-2" /> <span className="hidden sm:inline">Announce</span>
              </Button>
              )}
              <Button variant="outline" className="rounded-xl" onClick={() => router.push(`/teacher/class/${classId}/modules`)}>
                <FileText className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Modules</span>
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => router.push(`/teacher/class/${classId}/attendance`)}>
                <CheckCircle className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Attendance</span>
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => router.push(`/teacher/class/${classId}/office-hours`)}>
                <Clock className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Office Hours</span>
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => router.push(`/teacher/class/${classId}/forum`)}>
                <ClipboardList className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Forum</span>
              </Button>
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
                    {enrolledStudents.map((student) => {
                      const isTA = (classData?.taIds || []).includes(student.uid);
                      return (
                        <li
                          key={student.uid}
                          className="flex flex-col p-3 bg-muted/40 hover:bg-muted/60 rounded-lg cursor-pointer transition-colors"
                          onClick={() => router.push(`/teacher/class/${classId}/student/${student.uid}`)}
                        >
                          <div className="flex justify-between items-start w-full">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground truncate">{student.displayName}</span>
                                {isTA && (
                                  <Badge className="text-[9px] px-1.5 py-0 bg-violet-100 text-violet-700 border-none shrink-0">TA</Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground truncate block">{student.email}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <div className="flex flex-col items-end text-xs">
                                <span className="text-muted-foreground flex items-center">
                                  Grade: <b className="text-foreground ml-1">{student.latestGrade !== null ? `${student.latestGrade}%` : 'N/A'}</b>
                                </span>
                                <span className="text-muted-foreground flex items-center">
                                  Quiz: <b className="text-foreground ml-1">{student.latestQuiz !== null ? `${student.latestQuiz}%` : 'N/A'}</b>
                                </span>
                              </div>
                              {isClassOwner && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`h-7 text-[10px] rounded-md px-2 ${isTA ? 'text-violet-700 bg-violet-50 hover:bg-violet-100' : 'text-muted-foreground hover:text-violet-700 hover:bg-violet-50'}`}
                                  onClick={(e) => { e.stopPropagation(); handleToggleTA(student.uid); }}
                                >
                                  {isTA ? 'Remove TA' : 'Make TA'}
                                </Button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Archived Students */}
            {archivedStudents.length > 0 && (
              <Card className="border-amber-200/60 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center text-sm font-semibold text-amber-700 dark:text-amber-400">
                    <Users className="w-4 h-4 mr-2" />
                    Archived Students
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {archivedStudents.length} student{archivedStudents.length !== 1 ? 's' : ''} left the class. Reinvite or remove them.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {archivedStudents.map((student) => (
                      <li key={student.uid} className="p-3 bg-background/80 rounded-lg border border-border/50">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{student.displayName}</p>
                            <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            {reinviteConfirmId === student.uid ? (
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="default" className="h-7 text-xs rounded-lg px-2.5" onClick={() => handleReinviteStudent(student.uid)}>
                                  Confirm
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg px-2" onClick={() => setReinviteConfirmId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : deleteStudentConfirmId === student.uid ? (
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="destructive" className="h-7 text-xs rounded-lg px-2.5" onClick={() => handleDeleteArchivedStudent(student.uid)}>
                                  Delete
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg px-2" onClick={() => setDeleteStudentConfirmId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs rounded-lg px-2.5 text-primary border-primary/30 hover:bg-primary/10"
                                  onClick={() => { setReinviteConfirmId(student.uid); setDeleteStudentConfirmId(null); }}
                                >
                                  Reinvite
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs rounded-lg px-2 text-destructive hover:bg-destructive/10"
                                  onClick={() => { setDeleteStudentConfirmId(student.uid); setReinviteConfirmId(null); }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

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

                    {/* Confusion Heatmap Button */}
                    <Button
                      onClick={generateHeatmap}
                      disabled={isHeatmapLoading}
                      className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold shadow-md"
                    >
                      {isHeatmapLoading ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                      ) : (
                        <><Flame className="w-4 h-4 mr-2" /> Confusion Heatmap</>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Confusion Heatmap Dialog */}
            <Dialog open={showHeatmap} onOpenChange={setShowHeatmap}>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center text-xl">
                    <Flame className="w-5 h-5 mr-2 text-amber-500" />
                    Confusion Heatmap
                  </DialogTitle>
                  <DialogDescription>
                    AI analysis of concepts your class is struggling with — use this before a test or midterm to identify areas to reteach.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 pt-2">
                  {isHeatmapLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
                      <p className="text-sm text-muted-foreground">Analyzing quiz results and assignment grades...</p>
                    </div>
                  ) : heatmapData ? (
                    <>
                      {/* Analysis Summary */}
                      <div className="bg-muted/30 border rounded-xl p-5 text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                        {heatmapData.analysis}
                      </div>

                      {/* Topic Cards */}
                      {heatmapData.topics && heatmapData.topics.length > 0 && (
                        <div className="space-y-3">
                          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Struggling Concepts</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {heatmapData.topics.map((topic, idx) => {
                              const severityColors = {
                                high: 'border-red-300 bg-red-50/50 dark:border-red-800/50 dark:bg-red-950/20',
                                medium: 'border-amber-300 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-950/20',
                                low: 'border-blue-300 bg-blue-50/50 dark:border-blue-800/50 dark:bg-blue-950/20',
                              };
                              const severityBadge = {
                                high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                                medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                                low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                              };
                              const SIcon = topic.severity === 'high' ? AlertTriangle : TrendingDown;

                              return (
                                <div key={idx} className={`p-4 rounded-xl border ${severityColors[topic.severity] || severityColors.medium}`}>
                                  <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex items-start gap-2.5 min-w-0">
                                      <SIcon className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                                      <span className="text-sm font-semibold leading-tight">{topic.topic}</span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${severityBadge[topic.severity] || severityBadge.medium}`}>
                                        {topic.severity}
                                      </span>
                                      {topic.count > 0 && (
                                        <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">{topic.count} flags</span>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground leading-relaxed pl-6">{topic.description}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Regenerate button */}
                      <DialogFooter>
                        <Button
                          variant="outline"
                          className="rounded-xl"
                          onClick={generateHeatmap}
                          disabled={isHeatmapLoading}
                        >
                          <Flame className="w-4 h-4 mr-2" /> Regenerate Analysis
                        </Button>
                      </DialogFooter>
                    </>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
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
                
                {/* Upload Form — owner only */}
                {isClassOwner && (
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

                  <div className="flex items-center gap-2">
                    <Switch
                      id="syllabus-toggle"
                      checked={uploadIsSyllabus}
                      onCheckedChange={setUploadIsSyllabus}
                      disabled={isUploading}
                    />
                    <Label htmlFor="syllabus-toggle" className="text-sm font-medium cursor-pointer">
                      This is the class syllabus
                    </Label>
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
                )}

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
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                                {doc.isSyllabus && (
                                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-blue-50 text-blue-700 border-none shrink-0">Syllabus</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {doc.uploadedAt ? new Date(doc.uploadedAt.toMillis()).toLocaleDateString() : 'Just now'}
                              </p>
                            </div>
                          </div>
                          {isClassOwner && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive shrink-0 ml-2"
                              onClick={() => handleDeleteDoc(doc.id, doc.storageUrl)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
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
                  {isClassOwner && (
                    <Button onClick={openNewQuizDialog}>
                      <Plus className="w-4 h-4 mr-2" />
                      New Quiz
                    </Button>
                  )}
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
                              {isClassOwner && (
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
                              )}
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
                {isClassOwner && (
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
                      <Label htmlFor="asDueDate">Due Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input
                        id="asDueDate"
                        type="date"
                        value={uploadAssignmentDueDate}
                        onChange={(e) => setUploadAssignmentDueDate(e.target.value)}
                        disabled={isAssignmentUploading}
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>
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

                  <div className="space-y-2">
                    <Label>Student Submission Type</Label>
                    <div className="flex gap-2">
                      {[
                        { value: 'pdf', label: 'PDF Only' },
                        { value: 'text', label: 'Text Only' },
                        { value: 'both', label: 'PDF or Text' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setUploadSubmissionType(opt.value)}
                          disabled={isAssignmentUploading}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                            uploadSubmissionType === opt.value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background text-muted-foreground border-border hover:bg-muted'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {uploadSubmissionType === 'text' ? 'Students will type their answers with rich text and equation support.' :
                       uploadSubmissionType === 'both' ? 'Students can choose to upload a PDF or type their answers.' :
                       'Students must upload a PDF file.'}
                    </p>
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
                )}

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
                          <TableHead>Due Date</TableHead>
                          <TableHead className="w-[80px]">Actions</TableHead>
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
                             <TableCell>
                               {assignment.dueDate ? (() => {
                                 const d = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
                                 const diffDays = Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
                                 return (
                                   <Badge variant={diffDays <= 2 ? 'destructive' : 'secondary'} className="text-xs font-medium">
                                     {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                   </Badge>
                                 );
                               })() : <span className="text-muted-foreground text-xs">—</span>}
                             </TableCell>
                             {isClassOwner && (
                             <TableCell onClick={(e) => e.stopPropagation()}>
                               <DropdownMenu>
                                 <DropdownMenuTrigger asChild>
                                   <Button variant="ghost" size="icon" className="h-8 w-8">
                                     <MoreHorizontal className="h-4 w-4" />
                                     <span className="sr-only">Actions</span>
                                   </Button>
                                 </DropdownMenuTrigger>
                                 <DropdownMenuContent align="end">
                                   <DropdownMenuItem onClick={(e) => openEditAssignmentDialog(e, assignment)}>
                                     <Pencil className="mr-2 h-4 w-4" />
                                     Edit Config
                                   </DropdownMenuItem>
                                   {deleteAssignmentId === assignment.id ? (
                                     <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteAssignment(assignment); }}>
                                       <Trash2 className="mr-2 h-4 w-4" />
                                       Confirm Delete
                                     </DropdownMenuItem>
                                   ) : (
                                     <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteAssignmentId(assignment.id); }}>
                                       <Trash2 className="mr-2 h-4 w-4" />
                                       Delete Assignment
                                     </DropdownMenuItem>
                                   )}
                                 </DropdownMenuContent>
                               </DropdownMenu>
                             </TableCell>
                             )}
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
      {/* Assignment Edit Dialog */}
      <Dialog open={isAssignmentDialogOpen} onOpenChange={setIsAssignmentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Assignment</DialogTitle>
            <DialogDescription>
              Update the assignment details below. Note: Rubric cannot be edited once generated.
            </DialogDescription>
          </DialogHeader>
          <Form {...assignmentForm}>
            <form onSubmit={assignmentForm.handleSubmit(onAssignmentSubmit)} className="space-y-6">
              <div className="space-y-4">
                <FormField
                  control={assignmentForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Homework 1: Newton's Laws" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={assignmentForm.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Points per Question (optional) */}
                {editingAssignment?.rubric?.questions?.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">
                      Points per Question <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <div className="bg-muted/30 border rounded-lg p-3 space-y-2 max-h-52 overflow-y-auto">
                      {assignmentForm.watch('questionPoints')?.map((qp, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <span className="text-xs font-mono font-semibold text-muted-foreground w-12 shrink-0">
                            {qp.number || `Q${idx + 1}`}
                          </span>
                          <span className="text-xs text-muted-foreground truncate flex-1">
                            {editingAssignment.rubric.questions[idx]?.description?.slice(0, 50) || ''}
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="0.5"
                            className="w-20 h-8 text-sm text-center"
                            value={assignmentForm.watch(`questionPoints.${idx}.points`)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              assignmentForm.setValue(`questionPoints.${idx}.points`, val);
                            }}
                          />
                          <span className="text-xs text-muted-foreground shrink-0">pts</span>
                        </div>
                      ))}
                      {assignmentForm.watch('questionPoints')?.length > 0 && (
                        <div className="flex items-center justify-between pt-2 border-t mt-2">
                          <span className="text-xs font-semibold text-muted-foreground">Total</span>
                          <span className="text-sm font-bold">
                            {assignmentForm.watch('questionPoints')?.reduce((sum, q) => sum + (q.points || 0), 0)} pts
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAssignmentDialogOpen(false)}
                  disabled={isAssignmentSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isAssignmentSubmitting}
                >
                  {isAssignmentSubmitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Announcement Dialog */}
      <Dialog open={isAnnouncementOpen} onOpenChange={setIsAnnouncementOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-amber-500" />
              Send Announcement
            </DialogTitle>
            <DialogDescription>
              This message will be sent as a notification to all {classData?.studentIds?.length || 0} students in {classData?.name || 'this class'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <RichMathEditor
              onUpdate={(html) => setAnnouncementText(html)}
              placeholder="Write your announcement..."
              maxLength={2000}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{classData?.studentIds?.length || 0} student{(classData?.studentIds?.length || 0) !== 1 ? 's' : ''} will be notified</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAnnouncementOpen(false)} disabled={isSendingAnnouncement} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleSendAnnouncement}
              disabled={isSendingAnnouncement || !announcementText.trim()}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
            >
              {isSendingAnnouncement ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</> : <><Megaphone className="h-4 w-4 mr-2" /> Send to All</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Wrap with teacher auth guard
export default withAuth(TeacherClassPage, ['teacher', 'ta']);
