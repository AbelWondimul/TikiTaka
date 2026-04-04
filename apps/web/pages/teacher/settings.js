import { useEffect, useState } from 'react';
import Head from 'next/head';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import TeacherLayout from '@/components/layout/TeacherLayout';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, User, Bell, Brain, Shield, Save, Check } from 'lucide-react';

function TeacherSettings() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState('');

  // Profile
  const [displayName, setDisplayName] = useState('');

  // Notification prefs
  const [notifSubmissions, setNotifSubmissions] = useState(true);
  const [notifStudentLeft, setNotifStudentLeft] = useState(true);
  const [notifForumPosts, setNotifForumPosts] = useState(true);
  const [notifOfficeHours, setNotifOfficeHours] = useState(true);
  const [notifAppeals, setNotifAppeals] = useState(true);

  // AI grading config
  const [gradingStrictness, setGradingStrictness] = useState('moderate');
  const [gradingFeedbackStyle, setGradingFeedbackStyle] = useState('balanced');

  // Class defaults
  const [defaultExtensionPasses, setDefaultExtensionPasses] = useState(3);
  const [defaultLatePenalty, setDefaultLatePenalty] = useState(10);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      setDisplayName(user.displayName || '');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        const prefs = data.settings || {};
        setNotifSubmissions(prefs.notifSubmissions !== false);
        setNotifStudentLeft(prefs.notifStudentLeft !== false);
        setNotifForumPosts(prefs.notifForumPosts !== false);
        setNotifOfficeHours(prefs.notifOfficeHours !== false);
        setNotifAppeals(prefs.notifAppeals !== false);
        setGradingStrictness(prefs.gradingStrictness || 'moderate');
        setGradingFeedbackStyle(prefs.gradingFeedbackStyle || 'balanced');
        setDefaultExtensionPasses(prefs.defaultExtensionPasses ?? 3);
        setDefaultLatePenalty(prefs.defaultLatePenalty ?? 10);
      }
    } catch (err) { console.error(err); }
    finally { setIsLoading(false); }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    try {
      if (displayName.trim() !== user.displayName) {
        await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      }
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: displayName.trim(),
        settings: {
          notifSubmissions, notifStudentLeft, notifForumPosts, notifOfficeHours, notifAppeals,
          gradingStrictness, gradingFeedbackStyle,
          defaultExtensionPasses, defaultLatePenalty,
        },
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error(err);
      setError('Failed to save settings.');
    } finally { setIsSaving(false); }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess(false);
    if (!currentPassword || !newPassword) { setPasswordError('Both fields required.'); return; }
    if (newPassword.length < 6) { setPasswordError('New password must be at least 6 characters.'); return; }
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message);
    }
  };

  if (isLoading) return <TeacherLayout activePage="settings"><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></TeacherLayout>;

  return (
    <TeacherLayout activePage="settings">
      <Head><title>Settings - TikiTaka</title></Head>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your profile, notifications, and grading preferences.</p>
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="rounded-xl">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : saveSuccess ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saveSuccess ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {/* Profile */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><User className="h-4 w-4 mr-2 text-primary" /> Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={displayName} onChange={e => setDisplayName(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled className="rounded-xl bg-muted/30" />
              <p className="text-[10px] text-muted-foreground">Email cannot be changed.</p>
            </div>
          </CardContent>
        </Card>

        {/* Notification Preferences */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><Bell className="h-4 w-4 mr-2 text-primary" /> Notifications</CardTitle>
            <CardDescription>Choose which notifications you receive.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'New Submissions', desc: 'When a student submits an assignment', value: notifSubmissions, set: setNotifSubmissions },
              { label: 'Student Left Class', desc: 'When a student leaves your class', value: notifStudentLeft, set: setNotifStudentLeft },
              { label: 'Forum Posts', desc: 'New anonymous forum questions', value: notifForumPosts, set: setNotifForumPosts },
              { label: 'Office Hour Bookings', desc: 'When a student books office hours', value: notifOfficeHours, set: setNotifOfficeHours },
              { label: 'Grade Appeals', desc: 'When a student appeals a grade', value: notifAppeals, set: setNotifAppeals },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div><p className="text-sm font-medium">{item.label}</p><p className="text-[10px] text-muted-foreground">{item.desc}</p></div>
                <Switch checked={item.value} onCheckedChange={item.set} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* AI Grading */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><Brain className="h-4 w-4 mr-2 text-primary" /> AI Grading</CardTitle>
            <CardDescription>Configure how the AI grades student submissions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Grading Strictness</Label>
              <Select value={gradingStrictness} onValueChange={setGradingStrictness}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lenient">Lenient — Focus on effort and understanding</SelectItem>
                  <SelectItem value="moderate">Moderate — Balanced accuracy and effort</SelectItem>
                  <SelectItem value="strict">Strict — Precision and correctness required</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Feedback Style</Label>
              <Select value={gradingFeedbackStyle} onValueChange={setGradingFeedbackStyle}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="encouraging">Encouraging — Positive tone with growth suggestions</SelectItem>
                  <SelectItem value="balanced">Balanced — Clear feedback with both strengths and areas to improve</SelectItem>
                  <SelectItem value="direct">Direct — Concise, no-nonsense corrections</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Class Defaults */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><Shield className="h-4 w-4 mr-2 text-primary" /> Class Defaults</CardTitle>
            <CardDescription>Default settings applied to new classes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><Label>Default Extension Passes</Label><p className="text-[10px] text-muted-foreground">Per student per class</p></div>
              <Input type="number" min="0" max="10" value={defaultExtensionPasses} onChange={e => setDefaultExtensionPasses(parseInt(e.target.value) || 0)} className="w-20 rounded-xl h-9 text-center" />
            </div>
            <div className="flex items-center justify-between">
              <div><Label>Late Submission Penalty</Label><p className="text-[10px] text-muted-foreground">% deducted per day late</p></div>
              <div className="flex items-center gap-1">
                <Input type="number" min="0" max="50" value={defaultLatePenalty} onChange={e => setDefaultLatePenalty(parseInt(e.target.value) || 0)} className="w-20 rounded-xl h-9 text-center" />
                <span className="text-xs text-muted-foreground">%/day</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><Shield className="h-4 w-4 mr-2 text-primary" /> Change Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="rounded-xl" />
            </div>
            {passwordError && <Alert variant="destructive"><AlertDescription className="text-xs">{passwordError}</AlertDescription></Alert>}
            {passwordSuccess && <Alert className="bg-green-50 border-green-200"><AlertDescription className="text-xs text-green-700">Password changed successfully.</AlertDescription></Alert>}
            <Button variant="outline" onClick={handleChangePassword} className="rounded-xl">Update Password</Button>
          </CardContent>
        </Card>
      </div>
    </TeacherLayout>
  );
}
export default withAuth(TeacherSettings, 'teacher');
