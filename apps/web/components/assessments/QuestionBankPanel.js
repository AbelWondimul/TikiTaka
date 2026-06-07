import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, addDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, BookOpen } from 'lucide-react';

export function QuestionBankPanel({ isOpen, onClose, onAddQuestion }) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState([]);
  const [tagFilter, setTagFilter] = useState('');
  const [showShared, setShowShared] = useState(false);
  const [banks, setBanks] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const questionTypes = ['multiple_choice', 'true_false', 'short_answer', 'essay'];

  useEffect(() => {
    if (!isOpen || !user || !db) return;
    loadQuestions();
  }, [isOpen, user, showShared]);

  async function loadQuestions() {
    setLoading(true);
    try {
      let banksQuery;
      if (showShared) {
        banksQuery = query(collection(db, 'questionBanks'), where('isShared', '==', true));
      } else {
        banksQuery = query(collection(db, 'questionBanks'), where('teacherId', '==', user.uid));
      }

      const banksSnapshot = await getDocs(banksQuery);
      const banksData = banksSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setBanks(banksData);

      const allQuestions = [];
      for (const bank of banksData) {
        const questionsRef = collection(db, 'questionBanks', bank.id, 'questions');
        const questionsSnapshot = await getDocs(questionsRef);
        questionsSnapshot.docs.forEach(d => {
          allQuestions.push({ id: d.id, bankId: bank.id, bankName: bank.name, ...d.data() });
        });
      }
      setQuestions(allQuestions);
    } catch (err) {
      console.error('Error loading question banks:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleTypeFilter(type) {
    setTypeFilter(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }

  const filteredQuestions = questions.filter(q => {
    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      if (!q.content?.toLowerCase().includes(search)) return false;
    }
    if (typeFilter.length > 0 && !typeFilter.includes(q.type)) return false;
    if (tagFilter) {
      const tags = tagFilter.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length > 0 && !tags.some(tag => q.tags?.some(qt => qt.toLowerCase().includes(tag)))) {
        return false;
      }
    }
    return true;
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Question Bank
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
            <Input
              placeholder="Search questions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Type Filter */}
          <div className="flex flex-wrap gap-2">
            {questionTypes.map(type => (
              <label key={type} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={typeFilter.includes(type)}
                  onChange={() => toggleTypeFilter(type)}
                  className="h-3 w-3"
                />
                <span className="capitalize">{type.replace('_', ' ')}</span>
              </label>
            ))}
          </div>

          {/* Tags Filter */}
          <Input
            placeholder="Filter by tags (comma-separated)..."
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="text-sm"
          />

          {/* Toggle My / Shared */}
          <div className="flex gap-2">
            <Button
              variant={!showShared ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowShared(false)}
            >
              My Questions
            </Button>
            <Button
              variant={showShared ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowShared(true)}
            >
              Shared Questions
            </Button>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {loading ? (
              <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
            ) : filteredQuestions.length === 0 ? (
              <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No questions found in your question bank.</p>
                <p className="text-xs mt-1">Save questions from assessments to build your bank.</p>
              </div>
            ) : (
              filteredQuestions.map(question => (
                <div
                  key={`${question.bankId}-${question.id}`}
                  className="border rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                        {question.content?.substring(0, 80)}
                        {question.content?.length > 80 ? '...' : ''}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="secondary" className="text-xs">
                          {question.type?.replace('_', ' ')}
                        </Badge>
                        {question.points && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">{question.points} pts</span>
                        )}
                        {question.tags?.map(tag => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAddQuestion(question)}
                      className="shrink-0"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SaveToBank({ question, isOpen, onClose }) {
  const { user } = useAuth();
  const [banks, setBanks] = useState([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [tags, setTags] = useState('');
  const [course, setCourse] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !user || !db) return;
    loadBanks();
  }, [isOpen, user]);

  async function loadBanks() {
    try {
      const banksQuery = query(
        collection(db, 'questionBanks'),
        where('teacherId', '==', user.uid)
      );
      const snapshot = await getDocs(banksQuery);
      setBanks(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading banks:', err);
    }
  }

  async function handleSave() {
    if (!user || !db) return;
    setSaving(true);

    try {
      let bankId = selectedBankId;

      // Create new bank if needed
      if (selectedBankId === '__new__' && newBankName.trim()) {
        const bankDoc = await addDoc(collection(db, 'questionBanks'), {
          name: newBankName.trim(),
          teacherId: user.uid,
          course: course || null,
          isShared: false,
          createdAt: serverTimestamp(),
        });
        bankId = bankDoc.id;
      }

      if (!bankId) return;

      const questionTags = tags.split(',').map(t => t.trim()).filter(Boolean);

      await addDoc(collection(db, 'questionBanks', bankId, 'questions'), {
        content: question.content || '',
        type: question.type || 'short_answer',
        choices: question.choices || [],
        points: question.points || 1,
        tags: questionTags,
        course: course || null,
        createdAt: serverTimestamp(),
      });

      onClose();
    } catch (err) {
      console.error('Error saving to bank:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save to Question Bank</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bank Selector */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              Select Bank
            </label>
            <select
              value={selectedBankId}
              onChange={e => setSelectedBankId(e.target.value)}
              className="w-full border rounded-md p-2 text-sm bg-background"
            >
              <option value="">Choose a bank...</option>
              {banks.map(bank => (
                <option key={bank.id} value={bank.id}>{bank.name}</option>
              ))}
              <option value="__new__">+ Create new bank</option>
            </select>
          </div>

          {/* New Bank Name */}
          {selectedBankId === '__new__' && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
                New Bank Name
              </label>
              <Input
                placeholder="e.g., Algebra Chapter 3"
                value={newBankName}
                onChange={e => setNewBankName(e.target.value)}
              />
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              Tags (comma-separated)
            </label>
            <Input
              placeholder="e.g., algebra, quadratic, exam"
              value={tags}
              onChange={e => setTags(e.target.value)}
            />
          </div>

          {/* Course */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              Course
            </label>
            <Input
              placeholder="e.g., Math 101"
              value={course}
              onChange={e => setCourse(e.target.value)}
            />
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || (!selectedBankId || (selectedBankId === '__new__' && !newBankName.trim()))}
            >
              {saving ? 'Saving...' : 'Save to Bank'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QuestionBankPanel;
