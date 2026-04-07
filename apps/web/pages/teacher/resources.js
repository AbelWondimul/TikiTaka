import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  addDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';

import { db, storage } from '@/firebase';
import { uploadWithProgress } from '@/lib/storageUtils';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleClasses } from '@/lib/classUtils';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { deleteFile } from '@/lib/storageUtils';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, FileText, Trash2, ExternalLink, Search, FolderOpen, Plus, Upload } from 'lucide-react';

function TeacherResources() {
  const { user, role } = useAuth();
  const [classes, setClasses] = useState([]);
  const [kbDocs, setKbDocs] = useState([]);
  const [moduleResources, setModuleResources] = useState([]);
  const [modules, setModules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('knowledge'); // 'knowledge' | 'modules'
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [downloadUrls, setDownloadUrls] = useState({});

  // Upload dialog
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadClassId, setUploadClassId] = useState('');
  const [uploadTarget, setUploadTarget] = useState('knowledge'); // 'knowledge' | moduleId
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadIsSyllabus, setUploadIsSyllabus] = useState(false);
  const [uploadStudentVisible, setUploadStudentVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch classes (owned + TA)
      const cls = await getAccessibleClasses(user.uid, role);
      setClasses(cls);

      const taClassIds = cls.filter(c => c._isTA).map(c => c.id);

      // Fetch all KB docs (owned + TA classes)
      const docs = [];
      const seenKbIds = new Set();
      const kbQ = query(collection(db, 'knowledgeBase'), where('teacherId', '==', user.uid));
      const kbSnap = await getDocs(kbQ);
      kbSnap.forEach(d => { docs.push({ id: d.id, ...d.data() }); seenKbIds.add(d.id); });
      if (taClassIds.length > 0) {
        for (let i = 0; i < taClassIds.length; i += 30) {
          const taSnap = await getDocs(query(collection(db, 'knowledgeBase'), where('classId', 'in', taClassIds.slice(i, i + 30))));
          taSnap.forEach(d => { if (!seenKbIds.has(d.id)) { docs.push({ id: d.id, ...d.data() }); seenKbIds.add(d.id); } });
        }
      }
      docs.sort((a, b) => (b.uploadedAt?.toMillis?.() || 0) - (a.uploadedAt?.toMillis?.() || 0));
      setKbDocs(docs);

      // Fetch module resources (owned + TA classes)
      const modRes = [];
      const seenModResIds = new Set();
      const modResQ = query(collection(db, 'moduleResources'), where('teacherId', '==', user.uid));
      const modResSnap = await getDocs(modResQ);
      modResSnap.forEach(d => { modRes.push({ id: d.id, ...d.data() }); seenModResIds.add(d.id); });
      if (taClassIds.length > 0) {
        for (let i = 0; i < taClassIds.length; i += 30) {
          const taSnap = await getDocs(query(collection(db, 'moduleResources'), where('classId', 'in', taClassIds.slice(i, i + 30))));
          taSnap.forEach(d => { if (!seenModResIds.has(d.id)) { modRes.push({ id: d.id, ...d.data() }); seenModResIds.add(d.id); } });
        }
      }
      modRes.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setModuleResources(modRes);

      // Fetch modules for names (owned + TA classes)
      const mods = [];
      const seenModIds = new Set();
      const modsQ = query(collection(db, 'modules'), where('teacherId', '==', user.uid));
      const modsSnap = await getDocs(modsQ);
      modsSnap.forEach(d => { mods.push({ id: d.id, ...d.data() }); seenModIds.add(d.id); });
      if (taClassIds.length > 0) {
        for (let i = 0; i < taClassIds.length; i += 30) {
          const taSnap = await getDocs(query(collection(db, 'modules'), where('classId', 'in', taClassIds.slice(i, i + 30))));
          taSnap.forEach(d => { if (!seenModIds.has(d.id)) { mods.push({ id: d.id, ...d.data() }); seenModIds.add(d.id); } });
        }
      }
      setModules(mods);
    } catch (err) {
      console.error('Error fetching resources:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle.trim() || !uploadClassId) return;
    setIsUploading(true);
    try {
      if (uploadTarget === 'knowledge') {
        const docId = doc(collection(db, 'knowledgeBase')).id;
        const storagePath = `knowledgeBase/${uploadClassId}/${docId}.pdf`;
        await uploadWithProgress(storagePath, uploadFile, p => setUploadProgress(p));
        await addDoc(collection(db, 'knowledgeBase'), {
          docId, classId: uploadClassId, teacherId: user.uid,
          title: uploadTitle.trim(), storageUrl: storagePath,
          isSyllabus: uploadIsSyllabus, uploadedAt: serverTimestamp(),
        });
      } else {
        // Upload to a module
        const docId = doc(collection(db, 'moduleResources')).id;
        const storagePath = `moduleResources/${uploadClassId}/${docId}.pdf`;
        await uploadWithProgress(storagePath, uploadFile, p => setUploadProgress(p));
        const resData = {
          classId: uploadClassId, teacherId: user.uid, moduleId: uploadTarget,
          type: 'pdf', title: uploadTitle.trim(), storagePath,
          url: null, forKnowledgeBase: false, studentVisible: uploadStudentVisible,
          createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, 'moduleResources'), resData);
      }
      setIsUploadOpen(false);
      setUploadTitle(''); setUploadFile(null); setUploadIsSyllabus(false); setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchData();
    } catch (err) { console.error('Upload error:', err); }
    finally { setIsUploading(false); }
  };

  const handleView = async (kbDoc) => {
    if (downloadUrls[kbDoc.id]) {
      window.open(downloadUrls[kbDoc.id], '_blank');
      return;
    }
    try {
      const url = await getDownloadURL(ref(storage, kbDoc.storageUrl));
      setDownloadUrls(prev => ({ ...prev, [kbDoc.id]: url }));
      window.open(url, '_blank');
    } catch (err) {
      console.error('Error getting download URL:', err);
    }
  };

  const handleDelete = async (kbDoc) => {
    try {
      await deleteFile(kbDoc.storageUrl);
      await deleteDoc(doc(db, 'knowledgeBase', kbDoc.id));
      setKbDocs(prev => prev.filter(d => d.id !== kbDoc.id));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Error deleting resource:', err);
    }
  };

  const classMap = {};
  classes.forEach(c => { classMap[c.id] = c; });

  const filteredDocs = kbDocs.filter(d => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.title?.toLowerCase().includes(q) ||
      classMap[d.classId]?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <TeacherLayout activePage="resources">
      <Head>
        <title>Resources - TikiTaka</title>
      </Head>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Resources</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All resources across your classes — knowledge base docs and weekly module materials.
            </p>
          </div>
          <Button onClick={() => { setIsUploadOpen(true); setUploadClassId(classes[0]?.id || ''); setUploadTarget('knowledge'); }} className="rounded-xl">
            <Upload className="h-4 w-4 mr-2" /> Upload
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/40 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('knowledge')}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              activeTab === 'knowledge' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Knowledge Base ({kbDocs.length})
          </button>
          <button
            onClick={() => setActiveTab('modules')}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              activeTab === 'modules' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Module Resources ({moduleResources.length})
          </button>
        </div>

        {activeTab === 'knowledge' && <>
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title or class..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-10 rounded-xl"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : kbDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-2xl bg-muted/5">
            <FolderOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-base font-medium">No resources uploaded</p>
            <p className="text-sm text-muted-foreground mt-1">Upload knowledge base documents from your class pages.</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-2xl bg-muted/5">
            <Search className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No resources match "{searchQuery}"</p>
          </div>
        ) : (
          <Card className="rounded-2xl border-border/50 overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Document</TableHead>
                  <TableHead className="font-semibold">Class</TableHead>
                  <TableHead className="font-semibold">Uploaded</TableHead>
                  <TableHead className="font-semibold text-right w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocs.map((kbDoc) => {
                  const classObj = classMap[kbDoc.classId];
                  const uploadDate = kbDoc.uploadedAt?.toDate
                    ? kbDoc.uploadedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Unknown';

                  return (
                    <TableRow key={kbDoc.id} className="hover:bg-muted/20 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <FileText className="h-4 w-4 text-primary" />
                          </div>
                          <span className="text-sm font-semibold">{kbDoc.title || 'Untitled'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {classObj ? (
                          <Badge variant="secondary" className="text-[10px] font-semibold">
                            {classObj.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unknown</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{uploadDate}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {deleteConfirmId === kbDoc.id ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="destructive" className="h-7 text-xs rounded-lg" onClick={() => handleDelete(kbDoc)}>
                              Delete
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg" onClick={() => setDeleteConfirmId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs rounded-lg"
                              onClick={() => handleView(kbDoc)}
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-1" /> View
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs rounded-lg text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteConfirmId(kbDoc.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}

        </>}

        {activeTab === 'modules' && (
          <>
            {moduleResources.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-2xl bg-muted/5">
                <FolderOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-base font-medium">No module resources</p>
                <p className="text-sm text-muted-foreground mt-1">Add resources through the Modules page on each class.</p>
              </div>
            ) : (
              <Card className="rounded-2xl border-border/50 overflow-hidden shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="font-semibold">Resource</TableHead>
                      <TableHead className="font-semibold">Class</TableHead>
                      <TableHead className="font-semibold">Module</TableHead>
                      <TableHead className="font-semibold text-center">Visibility</TableHead>
                      <TableHead className="font-semibold text-center">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {moduleResources.map(r => {
                      const classObj = classMap[r.classId];
                      const mod = modules.find(m => m.id === r.moduleId);
                      return (
                        <TableRow key={r.id} className="hover:bg-muted/20 transition-colors">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                                r.type === 'video' ? 'bg-red-50 text-red-600' : r.type === 'pdf' ? 'bg-blue-50 text-blue-600' : 'bg-teal-50 text-teal-600'
                              )}>
                                {r.type === 'video' ? <Search className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                              </div>
                              <span className="text-sm font-semibold truncate">{r.title}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] font-semibold">{classObj?.name || 'Unknown'}</Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">{mod?.title || 'General'}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            {r.studentVisible ? (
                              <Badge className="text-[9px] bg-green-50 text-green-700 border-none">Students</Badge>
                            ) : (
                              <Badge className="text-[9px] bg-slate-100 text-slate-500 border-none">Hidden</Badge>
                            )}
                            {r.forKnowledgeBase && (
                              <Badge className="text-[9px] bg-amber-50 text-amber-700 border-none ml-1">AI</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-xs text-muted-foreground capitalize">{r.type}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        )}

        {/* Summary */}
        <p className="text-xs text-muted-foreground text-center">
          {kbDocs.length} knowledge base doc{kbDocs.length !== 1 ? 's' : ''} · {moduleResources.length} module resource{moduleResources.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Upload Dialog */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Resource</DialogTitle>
            <DialogDescription>Upload a PDF to a knowledge base or a weekly module.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Class</Label>
              <Select value={uploadClassId} onValueChange={(v) => { setUploadClassId(v); setUploadTarget('knowledge'); }}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Upload To</Label>
              <Select value={uploadTarget} onValueChange={setUploadTarget}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="knowledge">Knowledge Base (AI Grading)</SelectItem>
                  {modules.filter(m => m.classId === uploadClassId).map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="e.g. Chapter 5 Notes" className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label>PDF File</Label>
              <Input type="file" accept=".pdf" ref={fileInputRef} onChange={e => setUploadFile(e.target.files?.[0] || null)} className="rounded-xl cursor-pointer" />
            </div>
            {uploadTarget === 'knowledge' && (
              <div className="flex items-center justify-between">
                <div><Label className="text-sm">Mark as Syllabus</Label></div>
                <Switch checked={uploadIsSyllabus} onCheckedChange={setUploadIsSyllabus} />
              </div>
            )}
            {uploadTarget !== 'knowledge' && (
              <div className="flex items-center justify-between">
                <div><Label className="text-sm">Visible to Students</Label></div>
                <Switch checked={uploadStudentVisible} onCheckedChange={setUploadStudentVisible} />
              </div>
            )}
            {isUploading && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground"><span>Uploading...</span><span>{Math.round(uploadProgress)}%</span></div>
                <Progress value={uploadProgress} className="h-2" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUploadOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleUpload} disabled={isUploading || !uploadFile || !uploadTitle.trim() || !uploadClassId} className="rounded-xl">
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TeacherLayout>
  );
}

export default withAuth(TeacherResources, ['teacher', 'ta']);
