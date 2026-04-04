import { useEffect, useState } from 'react';
import Head from 'next/head';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, User, Bell, MessageCircle, Shield, Save, Check } from 'lucide-react';

function StudentSettings() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState('');

  // Profile
  const [displayName, setDisplayName] = useState('');

  // Notification prefs
  const [notifAssignments, setNotifAssignments] = useState(true);
  const [notifGrades, setNotifGrades] = useState(true);
  const [notifAnnouncements, setNotifAnnouncements] = useState(true);
  const [notifDueReminders, setNotifDueReminders] = useState(true);
  const [notifForumReplies, setNotifForumReplies] = useState(true);

  // Chatbot
  const [chatbotEnabled, setChatbotEnabled] = useState(true);

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
        const prefs = userDoc.data().settings || {};
        setNotifAssignments(prefs.notifAssignments !== false);
        setNotifGrades(prefs.notifGrades !== false);
        setNotifAnnouncements(prefs.notifAnnouncements !== false);
        setNotifDueReminders(prefs.notifDueReminders !== false);
        setNotifForumReplies(prefs.notifForumReplies !== false);
        setChatbotEnabled(prefs.chatbotEnabled !== false);
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
          notifAssignments, notifGrades, notifAnnouncements, notifDueReminders, notifForumReplies,
          chatbotEnabled,
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

  if (isLoading) return (
    <><Header /><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></>
  );

  return (
    <>
      <Head><title>Settings - TikiTaka</title></Head>
      <Header />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your profile and preferences.</p>
          </div>
          <Button onClick={handleSave} disabled={isSaving} className="rounded-xl">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : saveSuccess ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saveSuccess ? 'Saved!' : 'Save'}
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
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><Bell className="h-4 w-4 mr-2 text-primary" /> Notifications</CardTitle>
            <CardDescription>Choose what shows up in your notification bell.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'New Assignments', desc: 'When a teacher posts an assignment', value: notifAssignments, set: setNotifAssignments },
              { label: 'Grade Results', desc: 'When your submission is graded', value: notifGrades, set: setNotifGrades },
              { label: 'Announcements', desc: 'Class announcements from teachers', value: notifAnnouncements, set: setNotifAnnouncements },
              { label: 'Due Date Reminders', desc: 'Reminders the day before assignments are due', value: notifDueReminders, set: setNotifDueReminders },
              { label: 'Forum Replies', desc: 'When someone replies to your forum post', value: notifForumReplies, set: setNotifForumReplies },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div><p className="text-sm font-medium">{item.label}</p><p className="text-[10px] text-muted-foreground">{item.desc}</p></div>
                <Switch checked={item.value} onCheckedChange={item.set} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Chatbot */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center text-base"><MessageCircle className="h-4 w-4 mr-2 text-primary" /> Tika Chatbot</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Show Chatbot</p>
                <p className="text-[10px] text-muted-foreground">Toggle the Tika assistant on your dashboard</p>
              </div>
              <Switch checked={chatbotEnabled} onCheckedChange={setChatbotEnabled} />
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
    </>
  );
}
export default withAuth(StudentSettings, 'student');
