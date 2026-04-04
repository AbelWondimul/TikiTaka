import { useEffect, useState } from 'react';
import Head from 'next/head';
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';

import { db, storage } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { deleteFile } from '@/lib/storageUtils';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, FileText, Trash2, ExternalLink, Search, FolderOpen } from 'lucide-react';

function TeacherResources() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [kbDocs, setKbDocs] = useState([]);
  const [moduleResources, setModuleResources] = useState([]);
  const [modules, setModules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('knowledge'); // 'knowledge' | 'modules'
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [downloadUrls, setDownloadUrls] = useState({});

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch classes
      const classesQ = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const classesSnap = await getDocs(classesQ);
      const cls = [];
      classesSnap.forEach(d => cls.push({ id: d.id, ...d.data() }));
      setClasses(cls);

      // Fetch all KB docs across all classes
      const kbQ = query(collection(db, 'knowledgeBase'), where('teacherId', '==', user.uid));
      const kbSnap = await getDocs(kbQ);
      const docs = [];
      kbSnap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (b.uploadedAt?.toMillis?.() || 0) - (a.uploadedAt?.toMillis?.() || 0));
      setKbDocs(docs);

      // Fetch module resources
      const modResQ = query(collection(db, 'moduleResources'), where('teacherId', '==', user.uid));
      const modResSnap = await getDocs(modResQ);
      const modRes = [];
      modResSnap.forEach(d => modRes.push({ id: d.id, ...d.data() }));
      modRes.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setModuleResources(modRes);

      // Fetch modules for names
      const modsQ = query(collection(db, 'modules'), where('teacherId', '==', user.uid));
      const modsSnap = await getDocs(modsQ);
      const mods = [];
      modsSnap.forEach(d => mods.push({ id: d.id, ...d.data() }));
      setModules(mods);
    } catch (err) {
      console.error('Error fetching resources:', err);
    } finally {
      setIsLoading(false);
    }
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Resources</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All resources across your classes — knowledge base docs and weekly module materials.
          </p>
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
    </TeacherLayout>
  );
}

export default withAuth(TeacherResources, 'teacher');
