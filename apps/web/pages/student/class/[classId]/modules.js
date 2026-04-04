import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  collection, query, where, getDocs, getDoc, addDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';

import { db, storage } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, ArrowLeft, ChevronDown, FileText, Video, Link2, BookOpen, ExternalLink, Lock, CheckCircle, AlertCircle
} from 'lucide-react';

function StudentModules() {
  const router = useRouter();
  const { classId } = router.query;
  const { user } = useAuth();

  if (!router.isReady) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const [classData, setClassData] = useState(null);
  const [modules, setModules] = useState([]);
  const [resources, setResources] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedModuleId, setExpandedModuleId] = useState(null);
  const [pdfUrls, setPdfUrls] = useState({});

  // Progress tracking
  const [viewedResources, setViewedResources] = useState(new Set());
  const [quizScores, setQuizScores] = useState([]);
  const [submittedAssignmentIds, setSubmittedAssignmentIds] = useState(new Set());

  useEffect(() => {
    if (!classId || !user) return;
    fetchData();
  }, [classId, user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      if (classDoc.exists()) setClassData({ id: classDoc.id, ...classDoc.data() });

      // Modules
      const modsQ = query(collection(db, 'modules'), where('classId', '==', classId));
      const modsSnap = await getDocs(modsQ);
      const mods = [];
      modsSnap.forEach(d => mods.push({ id: d.id, ...d.data() }));
      mods.sort((a, b) => (a.weekNumber || 0) - (b.weekNumber || 0));
      setModules(mods);

      // Resources (student-visible only)
      const resQ = query(collection(db, 'moduleResources'), where('classId', '==', classId));
      const resSnap = await getDocs(resQ);
      const res = [];
      resSnap.forEach(d => {
        const data = { id: d.id, ...d.data() };
        if (data.studentVisible) res.push(data);
      });
      res.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setResources(res);

      // View progress
      const progressQ = query(collection(db, 'moduleProgress'), where('classId', '==', classId), where('studentId', '==', user.uid));
      const progressSnap = await getDocs(progressQ);
      const viewed = new Set();
      progressSnap.forEach(d => {
        const data = d.data();
        if (data.resourceId) viewed.add(data.resourceId);
      });
      setViewedResources(viewed);

      // Quiz scores for prerequisite checks
      const quizQ = query(collection(db, 'quizAttempts'), where('classId', '==', classId), where('studentId', '==', user.uid));
      const quizSnap = await getDocs(quizQ);
      const scores = [];
      quizSnap.forEach(d => scores.push(d.data().score || 0));
      setQuizScores(scores);

      // Submitted assignments for prerequisite checks
      const jobsQ = query(collection(db, 'gradingJobs'), where('classId', '==', classId), where('studentId', '==', user.uid));
      const jobsSnap = await getDocs(jobsQ);
      const submitted = new Set();
      jobsSnap.forEach(d => {
        const data = d.data();
        if (data.assignmentId) submitted.add(data.assignmentId);
      });
      setSubmittedAssignmentIds(submitted);
    } catch (err) {
      console.error('Error fetching modules:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const trackResourceView = async (resourceId) => {
    if (viewedResources.has(resourceId)) return;
    try {
      await addDoc(collection(db, 'moduleProgress'), {
        classId,
        studentId: user.uid,
        resourceId,
        viewedAt: serverTimestamp(),
      });
      setViewedResources(prev => new Set([...prev, resourceId]));
    } catch (err) {
      console.error('Error tracking view:', err);
    }
  };

  const handleOpenResource = async (resource) => {
    // Track the view
    await trackResourceView(resource.id);

    if (resource.url) {
      window.open(resource.url, '_blank');
      return;
    }
    if (resource.storagePath) {
      if (pdfUrls[resource.id]) {
        window.open(pdfUrls[resource.id], '_blank');
        return;
      }
      try {
        const url = await getDownloadURL(ref(storage, resource.storagePath));
        setPdfUrls(prev => ({ ...prev, [resource.id]: url }));
        window.open(url, '_blank');
      } catch (err) {
        console.error('Error getting PDF URL:', err);
      }
    }
  };

  // Check if a module's prerequisites are met
  const isModuleUnlocked = (mod) => {
    if (!mod.prerequisites || mod.prerequisites.length === 0) return true;

    return mod.prerequisites.every(prereq => {
      if (prereq.type === 'complete_module') {
        const targetResources = resources.filter(r => r.moduleId === prereq.moduleId);
        if (targetResources.length === 0) return true;
        return targetResources.every(r => viewedResources.has(r.id));
      }
      if (prereq.type === 'min_quiz_score') {
        return quizScores.some(s => s >= prereq.minScore);
      }
      if (prereq.type === 'assignment_completed') {
        return submittedAssignmentIds.has(prereq.assignmentId);
      }
      return true;
    });
  };

  // Get unmet prerequisites for display
  const getUnmetPrereqs = (mod) => {
    if (!mod.prerequisites) return [];
    return mod.prerequisites.filter(prereq => {
      if (prereq.type === 'complete_module') {
        const targetResources = resources.filter(r => r.moduleId === prereq.moduleId);
        if (targetResources.length === 0) return false;
        return !targetResources.every(r => viewedResources.has(r.id));
      }
      if (prereq.type === 'min_quiz_score') {
        return !quizScores.some(s => s >= prereq.minScore);
      }
      if (prereq.type === 'assignment_completed') {
        return !submittedAssignmentIds.has(prereq.assignmentId);
      }
      return false;
    });
  };

  const getResourceIcon = (type) => {
    if (type === 'video') return Video;
    if (type === 'pdf') return FileText;
    return Link2;
  };

  const getResourcesForModule = (moduleId) => resources.filter(r => r.moduleId === moduleId);

  const getModuleProgress = (moduleId) => {
    const modRes = getResourcesForModule(moduleId);
    if (modRes.length === 0) return 100;
    const viewed = modRes.filter(r => viewedResources.has(r.id)).length;
    return Math.round((viewed / modRes.length) * 100);
  };

  return (
    <>
      <Head>
        <title>Modules - {classData?.name || 'Class'} - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/student/class/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{classData?.name || 'Class'} — Modules</h1>
          </div>
          <p className="text-sm text-muted-foreground">Complete modules in order. Some may require finishing previous content first.</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : modules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border border-dashed rounded-2xl bg-muted/5 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">No modules yet</p>
            <p className="text-sm text-muted-foreground mt-1">Your instructor hasn't added any weekly modules.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {modules.map((mod, modIdx) => {
              const modResources = getResourcesForModule(mod.id);
              const isExpanded = expandedModuleId === mod.id;
              const unlocked = isModuleUnlocked(mod);
              const unmetPrereqs = getUnmetPrereqs(mod);
              const progress = getModuleProgress(mod.id);
              const isComplete = progress === 100 && modResources.length > 0;

              return (
                <Card
                  key={mod.id}
                  className={cn(
                    'rounded-2xl overflow-hidden transition-all',
                    !unlocked ? 'border-muted/40 opacity-75' : isComplete ? 'border-green-200/60' : 'border-border/50'
                  )}
                >
                  <button
                    className={cn(
                      'w-full p-4 flex items-center justify-between text-left transition-colors',
                      unlocked ? 'hover:bg-muted/20 cursor-pointer' : 'cursor-not-allowed'
                    )}
                    onClick={() => unlocked && setExpandedModuleId(isExpanded ? null : mod.id)}
                    disabled={!unlocked}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={cn(
                        'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                        !unlocked ? 'bg-muted' :
                        isComplete ? 'bg-green-100 dark:bg-green-900/30' : 'bg-primary/10'
                      )}>
                        {!unlocked ? (
                          <Lock className="h-5 w-5 text-muted-foreground" />
                        ) : isComplete ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <span className="text-sm font-bold text-primary">{mod.weekNumber || modIdx + 1}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-base font-bold truncate">{mod.title}</p>
                          {isComplete && <Badge className="bg-green-50 text-green-700 border-none text-[9px] px-1.5 py-0">Complete</Badge>}
                        </div>
                        {unlocked && modResources.length > 0 && (
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={progress} className="h-1.5 flex-1 max-w-[120px]" />
                            <span className="text-[10px] text-muted-foreground">{progress}%</span>
                          </div>
                        )}
                        {!unlocked && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {unmetPrereqs.length} requirement{unmetPrereqs.length !== 1 ? 's' : ''} remaining
                          </p>
                        )}
                      </div>
                    </div>
                    {unlocked && <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />}
                  </button>

                  {/* Locked state — show requirements */}
                  {!unlocked && (
                    <div className="border-t bg-amber-50/30 dark:bg-amber-950/10 px-4 py-3 space-y-2">
                      <p className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5" /> Requirements to unlock:
                      </p>
                      {unmetPrereqs.map((prereq, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 pl-5">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                          {prereq.type === 'complete_module' && `View all resources in "${prereq.moduleTitle}"`}
                          {prereq.type === 'min_quiz_score' && `Score at least ${prereq.minScore}% on a quiz`}
                          {prereq.type === 'assignment_completed' && `Submit "${prereq.assignmentTitle}"`}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Expanded resources */}
                  {isExpanded && unlocked && (
                    <div className="border-t bg-muted/5 p-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                      {modResources.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No resources in this module yet.</p>
                      ) : (
                        modResources.map(r => {
                          const Icon = getResourceIcon(r.type);
                          const viewed = viewedResources.has(r.id);
                          return (
                            <button
                              key={r.id}
                              onClick={() => handleOpenResource(r)}
                              className="w-full flex items-center gap-3 p-3 bg-background rounded-xl border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all text-left group"
                            >
                              <div className={cn(
                                'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                                r.type === 'video' ? 'bg-red-50 text-red-600' : r.type === 'pdf' ? 'bg-blue-50 text-blue-600' : 'bg-teal-50 text-teal-600'
                              )}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{r.title}</p>
                                <p className="text-[10px] text-muted-foreground capitalize">{r.type === 'pdf' ? 'PDF Document' : r.type === 'video' ? 'YouTube Video' : 'External Link'}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {viewed && <CheckCircle className="h-4 w-4 text-green-500" />}
                                <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(StudentModules, 'student');
