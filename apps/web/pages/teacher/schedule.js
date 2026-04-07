import { useEffect, useState } from 'react';
import Head from 'next/head';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleClasses } from '@/lib/classUtils';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Pencil, Trash2, Clock, CalendarDays } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7 AM to 8 PM

const DAY_COLORS = [
  'bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/30 dark:border-teal-700 dark:text-teal-300',
  'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300',
  'bg-violet-100 border-violet-300 text-violet-800 dark:bg-violet-900/30 dark:border-violet-700 dark:text-violet-300',
  'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300',
  'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:border-rose-700 dark:text-rose-300',
];

function formatHour(h) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display} ${suffix}`;
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function TeacherSchedule() {
  const { user, role } = useAuth();
  const [classes, setClasses] = useState([]);
  const [scheduleBlocks, setScheduleBlocks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formDays, setFormDays] = useState(['Monday']);
  const [formClassId, setFormClassId] = useState('');
  const [formStartTime, setFormStartTime] = useState('08:00');
  const [formEndTime, setFormEndTime] = useState('09:00');
  const [formRoom, setFormRoom] = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch accessible classes (owned + TA)
      const cls = await getAccessibleClasses(user.uid, role);
      setClasses(cls);

      // Fetch schedule blocks (owned + TA classes)
      const taClassIds = cls.filter(c => c._isTA).map(c => c.id);
      const blocks = [];
      const seenBlockIds = new Set();

      const schedQ = query(collection(db, 'schedules'), where('teacherId', '==', user.uid));
      const schedSnap = await getDocs(schedQ);
      schedSnap.forEach(d => { blocks.push({ id: d.id, ...d.data() }); seenBlockIds.add(d.id); });

      if (taClassIds.length > 0) {
        for (let i = 0; i < taClassIds.length; i += 30) {
          const taSnap = await getDocs(query(collection(db, 'schedules'), where('classId', 'in', taClassIds.slice(i, i + 30))));
          taSnap.forEach(d => { if (!seenBlockIds.has(d.id)) { blocks.push({ id: d.id, ...d.data() }); seenBlockIds.add(d.id); } });
        }
      }

      setScheduleBlocks(blocks);
    } catch (err) {
      console.error('Error fetching schedule:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const openNewBlockDialog = (day, hour) => {
    setEditingBlock(null);
    setFormDays(day ? [day] : ['Monday']);
    setFormClassId(classes[0]?.id || '');
    setFormStartTime(`${(hour || 8).toString().padStart(2, '0')}:00`);
    setFormEndTime(`${((hour || 8) + 1).toString().padStart(2, '0')}:00`);
    setFormRoom('');
    setIsDialogOpen(true);
  };

  const openEditBlockDialog = (block) => {
    setEditingBlock(block);
    setFormDays([block.day]);
    setFormClassId(block.classId);
    setFormStartTime(block.startTime);
    setFormEndTime(block.endTime);
    setFormRoom(block.room || '');
    setIsDialogOpen(true);
  };

  const toggleFormDay = (day) => {
    setFormDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSaveBlock = async () => {
    if (!formClassId || !formStartTime || !formEndTime || formDays.length === 0) return;
    setIsSaving(true);
    try {
      const classObj = classes.find(c => c.id === formClassId);

      if (editingBlock) {
        // Editing: update the single existing block
        const blockData = {
          teacherId: user.uid,
          classId: formClassId,
          className: classObj?.name || 'Class',
          day: formDays[0],
          startTime: formStartTime,
          endTime: formEndTime,
          room: formRoom.trim(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'schedules', editingBlock.id), blockData, { merge: true });
        setScheduleBlocks(prev => prev.map(b => b.id === editingBlock.id ? { ...b, ...blockData } : b));
      } else {
        // Creating: one block per selected day
        const newBlocks = [];
        for (const day of formDays) {
          const blockData = {
            teacherId: user.uid,
            classId: formClassId,
            className: classObj?.name || 'Class',
            day,
            startTime: formStartTime,
            endTime: formEndTime,
            room: formRoom.trim(),
            updatedAt: serverTimestamp(),
          };
          const newRef = doc(collection(db, 'schedules'));
          await setDoc(newRef, blockData);
          newBlocks.push({ id: newRef.id, ...blockData });
        }
        setScheduleBlocks(prev => [...prev, ...newBlocks]);
      }

      setIsDialogOpen(false);
    } catch (err) {
      console.error('Error saving block:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBlock = async (blockId) => {
    try {
      await deleteDoc(doc(db, 'schedules', blockId));
      setScheduleBlocks(prev => prev.filter(b => b.id !== blockId));
      setDeleteTarget(null);
    } catch (err) {
      console.error('Error deleting block:', err);
    }
  };

  // Get blocks for a specific day and hour
  const getBlocksAt = (day, hour) => {
    return scheduleBlocks.filter(b => {
      if (b.day !== day) return false;
      const [startH] = b.startTime.split(':').map(Number);
      const [endH, endM] = b.endTime.split(':').map(Number);
      const endHour = endM > 0 ? endH + 1 : endH;
      return hour >= startH && hour < endHour;
    });
  };

  // Check if this hour is the START of a block (to render the full block card)
  const isBlockStart = (block, hour) => {
    const [startH] = block.startTime.split(':').map(Number);
    return startH === hour;
  };

  // Get block height in rows
  const getBlockSpan = (block) => {
    const [startH] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const endHour = endM > 0 ? endH + 1 : endH;
    return endHour - startH;
  };

  const classColorMap = {};
  classes.forEach((c, idx) => {
    classColorMap[c.id] = DAY_COLORS[idx % DAY_COLORS.length];
  });

  return (
    <TeacherLayout activePage="schedule">
      <Head>
        <title>Schedule - TikiTaka</title>
      </Head>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Weekly Schedule</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your class timetable for the week.</p>
          </div>
          <Button onClick={() => openNewBlockDialog()} className="rounded-xl">
            <Plus className="h-4 w-4 mr-2" /> Add Class Block
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-2xl overflow-hidden bg-card shadow-sm">
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Header row */}
                <div className="grid grid-cols-[80px_repeat(5,1fr)] border-b bg-muted/30">
                  <div className="p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">Time</div>
                  {DAYS.map(day => (
                    <div key={day} className="p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground text-center border-l">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Time rows */}
                {HOURS.map(hour => (
                  <div key={hour} className="grid grid-cols-[80px_repeat(5,1fr)] border-b last:border-b-0 min-h-[60px]">
                    <div className="p-2 text-[11px] font-medium text-muted-foreground text-center border-r flex items-start justify-center pt-3">
                      {formatHour(hour)}
                    </div>
                    {DAYS.map(day => {
                      const blocksHere = getBlocksAt(day, hour);
                      const startingBlocks = blocksHere.filter(b => isBlockStart(b, hour));

                      return (
                        <div
                          key={day}
                          className="border-l relative min-h-[60px] hover:bg-muted/10 transition-colors cursor-pointer group"
                          onClick={() => {
                            if (startingBlocks.length === 0 && blocksHere.length === 0) {
                              openNewBlockDialog(day, hour);
                            }
                          }}
                        >
                          {/* Show + on hover for empty cells */}
                          {blocksHere.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Plus className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}

                          {startingBlocks.map(block => {
                            const span = getBlockSpan(block);
                            return (
                              <div
                                key={block.id}
                                className={cn(
                                  'absolute left-1 right-1 rounded-lg border px-2.5 py-1.5 z-10 cursor-pointer hover:shadow-md transition-shadow overflow-hidden',
                                  classColorMap[block.classId] || DAY_COLORS[0]
                                )}
                                style={{ height: `${span * 60 - 4}px`, top: '2px' }}
                                onClick={(e) => { e.stopPropagation(); openEditBlockDialog(block); }}
                              >
                                <p className="text-xs font-bold leading-tight truncate">{block.className}</p>
                                <p className="text-[10px] opacity-80 mt-0.5">
                                  {formatTime(block.startTime)} - {formatTime(block.endTime)}
                                </p>
                                {block.room && (
                                  <p className="text-[10px] opacity-70 mt-0.5">Room: {block.room}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        {classes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {classes.map((c, idx) => (
              <Badge key={c.id} variant="outline" className={cn('text-xs font-medium border', DAY_COLORS[idx % DAY_COLORS.length])}>
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Block Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBlock ? 'Edit Class Block' : 'Add Class Block'}</DialogTitle>
            <DialogDescription>Set the day, time, and class for this schedule block.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Class</Label>
              <Select value={formClassId} onValueChange={setFormClassId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{editingBlock ? 'Day' : 'Days'}</Label>
              {editingBlock ? (
                <Select value={formDays[0]} onValueChange={(v) => setFormDays([v])}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-1.5">
                  {DAYS.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleFormDay(d)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-xs font-semibold transition-all border',
                        formDays.includes(d)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                      )}
                    >
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input type="time" value={formStartTime} onChange={e => setFormStartTime(e.target.value)} className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input type="time" value={formEndTime} onChange={e => setFormEndTime(e.target.value)} className="rounded-xl" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Room <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={formRoom} onChange={e => setFormRoom(e.target.value)} placeholder="e.g. Room 204" className="rounded-xl" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            {editingBlock && (
              deleteTarget === editingBlock.id ? (
                <div className="flex items-center gap-2 mr-auto">
                  <Button size="sm" variant="destructive" className="rounded-lg" onClick={() => { handleDeleteBlock(editingBlock.id); setIsDialogOpen(false); }}>
                    Confirm Delete
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => setDeleteTarget(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="mr-auto text-destructive hover:bg-destructive/10 rounded-lg" onClick={() => setDeleteTarget(editingBlock.id)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              )
            )}
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving} className="rounded-xl">Cancel</Button>
            <Button onClick={handleSaveBlock} disabled={isSaving || !formClassId || formDays.length === 0} className="rounded-xl">
              {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : editingBlock ? 'Save Changes' : 'Add Block'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TeacherLayout>
  );
}

export default withAuth(TeacherSchedule, ['teacher', 'ta']);
