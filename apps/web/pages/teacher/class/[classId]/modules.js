import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  collection, query, where, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import { uploadWithProgress, deleteFile } from '@/lib/storageUtils';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, ArrowLeft, Plus, Trash2, ChevronDown, FileText, Video, Link2, BookOpen, Eye, EyeOff, GripVertical, ExternalLink, Upload
} from 'lucide-react';

const RESOURCE_TYPES = [
  { value: 'pdf', label: 'PDF Document', icon: FileText },
  { value: 'video', label: 'YouTube Video', icon: Video },
  { value: 'link', label: 'External Link', icon: Link2 },
];

function TeacherModules() {
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

  // Add module
  const [isAddingModule, setIsAddingModule] = useState(false);

  // Add resource dialog
  const [isResourceDialogOpen, setIsResourceDialogOpen] = useState(false);
  const [resourceTargetModuleId, setResourceTargetModuleId] = useState(null);
  const [resourceType, setResourceType] = useState('link');
  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [resourceFile, setResourceFile] = useState(null);
  const [resourceForKB, setResourceForKB] = useState(false);
  const [resourceStudentVisible, setResourceStudentVisible] = useState(true);
  const [isUploadingResource, setIsUploadingResource] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  // Delete confirmations
  const [deleteModuleId, setDeleteModuleId] = useState(null);
  const [deleteResourceId, setDeleteResourceId] = useState(null);

  // Prerequisites dialog
  const [prereqModuleId, setPrereqModuleId] = useState(null);
  const [prereqType, setPrereqType] = useState('complete_module');
  const [prereqTargetModuleId, setPrereqTargetModuleId] = useState('');
  const [prereqMinScore, setPrereqMinScore] = useState(80);
  const [prereqAssignmentId, setPrereqAssignmentId] = useState('');
  const [isPrereqDialogOpen, setIsPrereqDialogOpen] = useState(false);

  // Assignments & quizzes for prerequisite options
  const [classAssignments, setClassAssignments] = useState([]);
  const [classQuizzes, setClassQuizzes] = useState([]);

  useEffect(() => {
    if (!classId || !user) return;
    fetchData();
  }, [classId, user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const classDoc = await getDoc(doc(db, 'classes', classId));
      const cls = classDoc.exists() ? { id: classDoc.id, ...classDoc.data() } : null;
      if (cls) setClassData(cls);

      const isTA = cls && (cls.taIds || []).includes(user.uid);
      const modsQ = isTA
        ? query(collection(db, 'modules'), where('classId', '==', classId))
        : query(collection(db, 'modules'), where('classId', '==', classId), where('teacherId', '==', user.uid));
      const modsSnap = await getDocs(modsQ);
      const mods = [];
      modsSnap.forEach(d => mods.push({ id: d.id, ...d.data() }));
      mods.sort((a, b) => (a.weekNumber || 0) - (b.weekNumber || 0));
      setModules(mods);

      const resQ = isTA
        ? query(collection(db, 'moduleResources'), where('classId', '==', classId))
        : query(collection(db, 'moduleResources'), where('classId', '==', classId), where('teacherId', '==', user.uid));
      const resSnap = await getDocs(resQ);
      const res = [];
      resSnap.forEach(d => res.push({ id: d.id, ...d.data() }));
      res.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      setResources(res);

      // Fetch assignments for prerequisite options
      const assignQ = query(collection(db, 'assignments'), where('classId', '==', classId));
      const assignSnap = await getDocs(assignQ);
      const assigns = [];
      assignSnap.forEach(d => assigns.push({ id: d.id, ...d.data() }));
      setClassAssignments(assigns);

      // Fetch quizzes for prerequisite options
      const quizQ = isTA
        ? query(collection(db, 'quizzes'), where('classId', '==', classId))
        : query(collection(db, 'quizzes'), where('classId', '==', classId), where('teacherId', '==', user.uid));
      const quizSnap = await getDocs(quizQ);
      const quizzes = [];
      quizSnap.forEach(d => quizzes.push({ id: d.id, ...d.data() }));
      setClassQuizzes(quizzes);
    } catch (err) {
      console.error('Error fetching modules:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddModule = async () => {
    setIsAddingModule(true);
    try {
      const nextWeek = modules.length > 0 ? Math.max(...modules.map(m => m.weekNumber || 0)) + 1 : 1;
      const newMod = {
        classId,
        teacherId: user.uid,
        weekNumber: nextWeek,
        title: `Week ${nextWeek}`,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'modules'), newMod);
      setModules(prev => [...prev, { id: ref.id, ...newMod }]);
      setExpandedModuleId(ref.id);
    } catch (err) {
      console.error('Error adding module:', err);
    } finally {
      setIsAddingModule(false);
    }
  };

  const handleRenameModule = async (moduleId, newTitle) => {
    try {
      await updateDoc(doc(db, 'modules', moduleId), { title: newTitle });
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, title: newTitle } : m));
    } catch (err) {
      console.error('Error renaming module:', err);
    }
  };

  const handleDeleteModule = async (moduleId) => {
    try {
      // Delete all resources in this module
      const modResources = resources.filter(r => r.moduleId === moduleId);
      for (const r of modResources) {
        if (r.storagePath) await deleteFile(r.storagePath).catch(() => {});
        await deleteDoc(doc(db, 'moduleResources', r.id));
      }
      await deleteDoc(doc(db, 'modules', moduleId));
      setModules(prev => prev.filter(m => m.id !== moduleId));
      setResources(prev => prev.filter(r => r.moduleId !== moduleId));
      setDeleteModuleId(null);
    } catch (err) {
      console.error('Error deleting module:', err);
    }
  };

  const openPrereqDialog = (moduleId) => {
    setPrereqModuleId(moduleId);
    setPrereqType('complete_module');
    setPrereqTargetModuleId('');
    setPrereqMinScore(80);
    setPrereqAssignmentId('');
    setIsPrereqDialogOpen(true);
  };

  const handleAddPrereq = async () => {
    if (!prereqModuleId) return;
    const mod = modules.find(m => m.id === prereqModuleId);
    const existingPrereqs = mod?.prerequisites || [];

    let newPrereq = {};
    if (prereqType === 'complete_module' && prereqTargetModuleId) {
      const targetMod = modules.find(m => m.id === prereqTargetModuleId);
      newPrereq = { type: 'complete_module', moduleId: prereqTargetModuleId, moduleTitle: targetMod?.title || 'Module' };
    } else if (prereqType === 'min_quiz_score') {
      newPrereq = { type: 'min_quiz_score', minScore: prereqMinScore };
    } else if (prereqType === 'assignment_completed' && prereqAssignmentId) {
      const assign = classAssignments.find(a => a.id === prereqAssignmentId);
      newPrereq = { type: 'assignment_completed', assignmentId: prereqAssignmentId, assignmentTitle: assign?.title || 'Assignment' };
    } else {
      return;
    }

    const updatedPrereqs = [...existingPrereqs, newPrereq];
    try {
      await updateDoc(doc(db, 'modules', prereqModuleId), { prerequisites: updatedPrereqs });
      setModules(prev => prev.map(m => m.id === prereqModuleId ? { ...m, prerequisites: updatedPrereqs } : m));
      setIsPrereqDialogOpen(false);
    } catch (err) {
      console.error('Error adding prerequisite:', err);
    }
  };

  const handleRemovePrereq = async (moduleId, prereqIndex) => {
    const mod = modules.find(m => m.id === moduleId);
    const updatedPrereqs = (mod?.prerequisites || []).filter((_, i) => i !== prereqIndex);
    try {
      await updateDoc(doc(db, 'modules', moduleId), { prerequisites: updatedPrereqs });
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, prerequisites: updatedPrereqs } : m));
    } catch (err) {
      console.error('Error removing prerequisite:', err);
    }
  };

  const openAddResourceDialog = (moduleId) => {
    setResourceTargetModuleId(moduleId);
    setResourceType('link');
    setResourceTitle('');
    setResourceUrl('');
    setResourceFile(null);
    setResourceForKB(false);
    setResourceStudentVisible(true);
    setUploadProgress(0);
    setIsResourceDialogOpen(true);
  };

  const handleAddResource = async () => {
    if (!resourceTitle.trim()) return;
    setIsUploadingResource(true);
    try {
      let storagePath = null;
      let url = resourceUrl.trim();

      if (resourceType === 'pdf' && resourceFile) {
        const docId = doc(collection(db, 'moduleResources')).id;
        storagePath = `moduleResources/${classId}/${docId}.pdf`;
        await uploadWithProgress(storagePath, resourceFile, (p) => setUploadProgress(p));
      }

      const resourceData = {
        classId,
        teacherId: user.uid,
        moduleId: resourceTargetModuleId,
        type: resourceType,
        title: resourceTitle.trim(),
        url: resourceType !== 'pdf' ? url : null,
        storagePath: storagePath || null,
        forKnowledgeBase: resourceForKB,
        studentVisible: resourceStudentVisible,
        createdAt: serverTimestamp(),
      };

      // If marked for knowledge base and it's a PDF, also add to knowledgeBase collection
      if (resourceForKB && storagePath) {
        await addDoc(collection(db, 'knowledgeBase'), {
          classId,
          teacherId: user.uid,
          title: resourceTitle.trim(),
          storageUrl: storagePath,
          isSyllabus: false,
          uploadedAt: serverTimestamp(),
        });
      }

      const ref = await addDoc(collection(db, 'moduleResources'), resourceData);
      setResources(prev => [...prev, { id: ref.id, ...resourceData }]);
      setIsResourceDialogOpen(false);
    } catch (err) {
      console.error('Error adding resource:', err);
    } finally {
      setIsUploadingResource(false);
    }
  };

  const handleDeleteResource = async (resource) => {
    try {
      if (resource.storagePath) await deleteFile(resource.storagePath).catch(() => {});
      await deleteDoc(doc(db, 'moduleResources', resource.id));
      setResources(prev => prev.filter(r => r.id !== resource.id));
      setDeleteResourceId(null);
    } catch (err) {
      console.error('Error deleting resource:', err);
    }
  };

  const handleToggleVisibility = async (resource) => {
    try {
      await updateDoc(doc(db, 'moduleResources', resource.id), { studentVisible: !resource.studentVisible });
      setResources(prev => prev.map(r => r.id === resource.id ? { ...r, studentVisible: !r.studentVisible } : r));
    } catch (err) {
      console.error('Error toggling visibility:', err);
    }
  };

  const getResourceIcon = (type) => {
    const found = RESOURCE_TYPES.find(t => t.value === type);
    return found ? found.icon : Link2;
  };

  const getResourcesForModule = (moduleId) => resources.filter(r => r.moduleId === moduleId);

  const isTA = classData && (classData.taIds || []).includes(user.uid);

  return (
    <>
      <Head>
        <title>Modules - {classData?.name || 'Class'} - TikiTaka</title>
      </Head>
      <Header />

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/teacher/class/${classId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Class
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{classData?.name || 'Class'} — Weekly Modules</h1>
              <p className="text-sm text-muted-foreground mt-1">Organize resources by week. Choose what students see vs. what helps AI grading.</p>
            </div>
            {!isTA && (
              <Button onClick={handleAddModule} disabled={isAddingModule} className="rounded-xl">
                {isAddingModule ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Week
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : modules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border border-dashed rounded-2xl bg-muted/5 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">No modules yet</p>
            <p className="text-sm text-muted-foreground mt-1">Click "Add Week" to create your first weekly module.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {modules.map((mod) => {
              const modResources = getResourcesForModule(mod.id);
              const isExpanded = expandedModuleId === mod.id;

              return (
                <Card key={mod.id} className="rounded-2xl border-border/50 overflow-hidden">
                  {/* Module header */}
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/20 transition-colors"
                    onClick={() => setExpandedModuleId(isExpanded ? null : mod.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-primary">{mod.weekNumber || '?'}</span>
                      </div>
                      <div>
                        {isTA ? (
                          <p className="text-base font-bold">{mod.title}</p>
                        ) : (
                          <input
                            className="text-base font-bold bg-transparent border-none outline-none focus:ring-0 p-0 w-full"
                            value={mod.title}
                            onChange={(e) => setModules(prev => prev.map(m => m.id === mod.id ? { ...m, title: e.target.value } : m))}
                            onBlur={(e) => handleRenameModule(mod.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                        <p className="text-xs text-muted-foreground">{modResources.length} resource{modResources.length !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isTA && (deleteModuleId === mod.id ? (
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="destructive" className="h-7 text-xs rounded-lg" onClick={() => handleDeleteModule(mod.id)}>Delete</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg" onClick={() => setDeleteModuleId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteModuleId(mod.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ))}
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                    </div>
                  </div>

                  {/* Module content */}
                  {isExpanded && (
                    <div className="border-t bg-muted/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      {modResources.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No resources yet. Add videos, PDFs, or links below.</p>
                      ) : (
                        <div className="space-y-2">
                          {modResources.map(r => {
                            const Icon = getResourceIcon(r.type);
                            return (
                              <div key={r.id} className="flex items-center gap-3 p-3 bg-background rounded-xl border border-border/50 group">
                                <div className={cn(
                                  'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                                  r.type === 'video' ? 'bg-red-50 text-red-600' : r.type === 'pdf' ? 'bg-blue-50 text-blue-600' : 'bg-teal-50 text-teal-600'
                                )}>
                                  <Icon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{r.title}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {r.forKnowledgeBase && (
                                      <Badge className="text-[8px] px-1 py-0 bg-amber-50 text-amber-700 border-none">AI Grading</Badge>
                                    )}
                                    {r.studentVisible ? (
                                      <Badge className="text-[8px] px-1 py-0 bg-green-50 text-green-700 border-none"><Eye className="h-2.5 w-2.5 mr-0.5" /> Visible</Badge>
                                    ) : (
                                      <Badge className="text-[8px] px-1 py-0 bg-slate-100 text-slate-500 border-none"><EyeOff className="h-2.5 w-2.5 mr-0.5" /> Hidden</Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {!isTA && (
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" title="Toggle student visibility" onClick={() => handleToggleVisibility(r)}>
                                      {r.studentVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    </Button>
                                  )}
                                  {r.url && (
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => window.open(r.url, '_blank')}>
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {!isTA && (deleteResourceId === r.id ? (
                                    <div className="flex gap-1">
                                      <Button size="sm" variant="destructive" className="h-6 text-[10px] rounded px-1.5" onClick={() => handleDeleteResource(r)}>Yes</Button>
                                      <Button size="sm" variant="ghost" className="h-6 text-[10px] rounded px-1.5" onClick={() => setDeleteResourceId(null)}>No</Button>
                                    </div>
                                  ) : (
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteResourceId(r.id)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Prerequisites */}
                      <div className="space-y-2 pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Prerequisites</p>
                          {!isTA && (
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] rounded-md px-2 text-primary" onClick={() => openPrereqDialog(mod.id)}>
                              <Plus className="h-3 w-3 mr-1" /> Add Rule
                            </Button>
                          )}
                        </div>
                        {(!mod.prerequisites || mod.prerequisites.length === 0) ? (
                          <p className="text-[10px] text-muted-foreground italic">No prerequisites — this module is open to all students.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {mod.prerequisites.map((prereq, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-800/30 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <span className="text-amber-600 text-xs">🔒</span>
                                  <span className="text-xs font-medium text-foreground">
                                    {prereq.type === 'complete_module' && `Complete "${prereq.moduleTitle}"`}
                                    {prereq.type === 'min_quiz_score' && `Score at least ${prereq.minScore}% on any quiz`}
                                    {prereq.type === 'assignment_completed' && `Submit "${prereq.assignmentTitle}"`}
                                  </span>
                                </div>
                                {!isTA && (
                                  <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleRemovePrereq(mod.id, idx)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {!isTA && (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1 rounded-xl text-xs" onClick={() => openAddResourceDialog(mod.id)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Resource
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Resource Dialog */}
      <Dialog open={isResourceDialogOpen} onOpenChange={setIsResourceDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Resource</DialogTitle>
            <DialogDescription>Add a video, PDF, or link to this week's module.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Resource Type</Label>
              <Select value={resourceType} onValueChange={(v) => { setResourceType(v); setResourceUrl(''); setResourceFile(null); }}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={resourceTitle} onChange={e => setResourceTitle(e.target.value)} placeholder="e.g. Chapter 3 Lecture" className="rounded-xl" />
            </div>

            {resourceType === 'pdf' ? (
              <div className="space-y-2">
                <Label>PDF File</Label>
                <Input type="file" accept=".pdf" ref={fileInputRef} onChange={e => setResourceFile(e.target.files?.[0] || null)}
                  className="rounded-xl cursor-pointer file:cursor-pointer file:text-foreground file:font-medium file:border-0 file:bg-transparent file:mr-4" />
                {isUploadingResource && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Uploading...</span><span>{Math.round(uploadProgress)}%</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{resourceType === 'video' ? 'YouTube URL' : 'URL'}</Label>
                <Input value={resourceUrl} onChange={e => setResourceUrl(e.target.value)}
                  placeholder={resourceType === 'video' ? 'https://youtube.com/watch?v=...' : 'https://...'}
                  className="rounded-xl" />
              </div>
            )}

            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Visible to Students</Label>
                  <p className="text-[10px] text-muted-foreground">Students can see this resource</p>
                </div>
                <Switch checked={resourceStudentVisible} onCheckedChange={setResourceStudentVisible} />
              </div>
              {resourceType === 'pdf' && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Use for AI Grading</Label>
                    <p className="text-[10px] text-muted-foreground">Add to knowledge base for grading context</p>
                  </div>
                  <Switch checked={resourceForKB} onCheckedChange={setResourceForKB} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResourceDialogOpen(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={handleAddResource}
              disabled={isUploadingResource || !resourceTitle.trim() || (resourceType === 'pdf' ? !resourceFile : !resourceUrl.trim())}
              className="rounded-xl"
            >
              {isUploadingResource ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading...</> : <><Plus className="h-4 w-4 mr-2" /> Add Resource</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prerequisites Dialog */}
      <Dialog open={isPrereqDialogOpen} onOpenChange={setIsPrereqDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Prerequisite</DialogTitle>
            <DialogDescription>Set a requirement students must meet before accessing this module.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Requirement Type</Label>
              <Select value={prereqType} onValueChange={setPrereqType}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="complete_module">Complete a previous module</SelectItem>
                  <SelectItem value="min_quiz_score">Minimum quiz score</SelectItem>
                  <SelectItem value="assignment_completed">Assignment submitted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {prereqType === 'complete_module' && (
              <div className="space-y-2">
                <Label>Required Module</Label>
                <Select value={prereqTargetModuleId} onValueChange={setPrereqTargetModuleId}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a module" /></SelectTrigger>
                  <SelectContent>
                    {modules.filter(m => m.id !== prereqModuleId).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Student must view all resources in this module.</p>
              </div>
            )}

            {prereqType === 'min_quiz_score' && (
              <div className="space-y-2">
                <Label>Minimum Score (%)</Label>
                <Input type="number" min="0" max="100" value={prereqMinScore} onChange={e => setPrereqMinScore(parseInt(e.target.value) || 0)} className="rounded-xl" />
                <p className="text-[10px] text-muted-foreground">Student must score at least this % on any quiz in this class.</p>
              </div>
            )}

            {prereqType === 'assignment_completed' && (
              <div className="space-y-2">
                <Label>Required Assignment</Label>
                <Select value={prereqAssignmentId} onValueChange={setPrereqAssignmentId}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select an assignment" /></SelectTrigger>
                  <SelectContent>
                    {classAssignments.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Student must have submitted this assignment.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPrereqDialogOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleAddPrereq} className="rounded-xl">Add Requirement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default withAuth(TeacherModules, ['teacher', 'ta']);
